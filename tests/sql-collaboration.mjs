// PostgreSQL authorization regression checks; Supabase Auth is emulated locally.
// This suite makes no network requests and creates no real accounts or messages.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const migrations = new URL("../supabase/migrations/", import.meta.url);
const SQL = await Promise.all([
  "20261026000000_crm_workspaces.sql",
  "20261026010000_crm_roles.sql",
  "20261026020000_crm_collaboration.sql",
].map((name) => readFile(new URL(name, migrations), "utf8")));
const TEAM = "534341de-9a86-4d96-b7f8-57fd96be6e3a";
const OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const M = "44444444-4444-4444-8444-444444444444";
const O = "55555555-5555-4555-8555-555555555555";
const P = "66666666-6666-4666-8666-666666666666";
const S = "77777777-7777-4777-8777-777777777777";
let checks = 0;
function ok(value, label) {
  assert.ok(value, label);
  checks++;
}
async function fails(operation, pattern) {
  let failure;
  try { await operation(); } catch (error) { failure = error; }
  assert.ok(failure, "Expected operation to be refused");
  if (pattern) assert.match(failure.message, pattern);
  checks++;
}
async function actor(id, operation) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  try { return await operation(); }
  finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  }
}
async function rpc(id, expression, parameters = []) {
  return actor(id, async () => (await db.query("select " + expression + " as value", parameters)).rows[0].value);
}
async function one(query, parameters = []) {
  return (await db.query(query, parameters)).rows[0];
}
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;`);
  for (const [id, name] of [[A,"Admin"],[B,"Bruna"],[C,"Carlos"],[M,"Gestor"],[O,"Outra equipe"],[P,"Pendente"],[S,"Suspenso"]]) {
    await db.query("insert into auth.users values($1,$2,now(),$3::jsonb)",
      [id, id.slice(0,8) + "@example.invalid", JSON.stringify({ full_name: name })]);
  }
  await db.exec(SQL[0]);
  await db.exec(SQL[1]);
  await db.query("insert into public.crm_teams(id,name) values($1,'Other organization')", [OTHER]);
  for (const [team, id, role, active] of [[TEAM,A,"admin",true],[TEAM,B,"user",true],[TEAM,C,"user",true],[TEAM,M,"manager",true],[TEAM,S,"user",false],[OTHER,O,"admin",true]]) {
    await db.query("insert into public.crm_members(workspace_id,user_id,role,active) values($1,$2,$3,$4)", [team,id,role,active]);
  }
  await db.query("insert into public.crm_records(workspace_id,collection,id,owner_id,payload) values($1,'companies','preserved',$2,$3::jsonb)",
    [TEAM,A,JSON.stringify({id:"preserved",name:"Existing business record"})]);
  await db.exec(SQL[2]);
  ok((await one("select count(*)::int n from pg_class where relname in ('crm_chat_conversations','crm_chat_messages','crm_chat_reads','crm_feed_posts','crm_feed_comments','crm_feed_reactions') and relrowsecurity and relforcerowsecurity")).n === 6, "six collaboration tables enforce RLS");
  for (const table of ['crm_chat_reads', 'crm_feed_reactions']) {
    const primary = await one("select pg_get_constraintdef(oid) definition from pg_constraint where conrelid=$1::regclass and contype='p'", ['public.'+table]);
    ok(primary.definition === 'PRIMARY KEY (id)', table+' publishes only an opaque row identifier on DELETE');
    const identifier = await one("select data_type, column_default from information_schema.columns where table_schema='public' and table_name=$1 and column_name='id'", [table]);
    ok(identifier.data_type === 'uuid' && identifier.column_default.includes('gen_random_uuid'), table+' uses generated UUID identity');
  }
  await fails(() => rpc(P,"public.crm_chat_list()"), /liberado/i);
  await fails(() => rpc(S,"public.crm_feed_list()"), /liberado/i);
  await db.exec("set role anon");
  await fails(() => db.query("select * from public.crm_feed_posts"), /permission denied/i);
  await fails(() => db.query("select public.crm_chat_list()"), /permission denied/i);
  await db.exec("reset role");

  const listA = await rpc(A, "public.crm_chat_list()");
  const team = listA.conversations[0];
  ok(team.kind === "team" && listA.totalUnread === 0, "first list creates team channel");
  const listB = await rpc(B, "public.crm_chat_list()");
  ok(listB.conversations[0].id === team.id, "team channel reused by colleagues");
  const otherTeam = (await rpc(O, "public.crm_chat_list()")).conversations[0];
  ok(otherTeam.id !== team.id, "separate organizations have separate channels");
  await fails(() => rpc(O, "public.crm_chat_history($1)", [team.id]), /participa/i);
  await fails(() => rpc(B, "public.crm_chat_open($1)", [B]), /outro colaborador/i);
  await fails(() => rpc(B, "public.crm_chat_open($1)", [O]), /outro colaborador/i);
  await fails(() => rpc(B, "public.crm_chat_open($1)", [S]), /outro colaborador/i);

  const direct = await rpc(B, "public.crm_chat_open($1)", [C]);
  ok(direct.kind === "direct" && direct.peerId === C && direct.title === "Carlos", "direct conversation identifies peer");
  ok((await rpc(C, "public.crm_chat_open($1)", [B])).id === direct.id, "reverse pair opening reuses conversation");
  ok((await rpc(B, "public.crm_chat_open($1)", [C])).id === direct.id, "duplicate direct opening is idempotent");
  await fails(() => rpc(A, "public.crm_chat_history($1)", [direct.id]), /participa/i);
  await fails(() => rpc(M, "public.crm_chat_send($1,$2)", [direct.id,"not allowed"]), /participa/i);
  ok((await actor(A, () => db.query("select * from public.crm_chat_conversations where id=$1", [direct.id]))).rows.length === 0, "administrator cannot read another pair through REST-equivalent SELECT");
  await fails(() => actor(B, () => db.query("select public.crm_chat_conversation_json($1)", [direct.id])), /permission denied/i);
  await fails(() => actor(B, () => db.query("insert into public.crm_chat_messages(workspace_id,conversation_id,sender_id,sender_name,body) values($1,$2,$3,'Forged','Forged')", [TEAM,direct.id,A])), /permission denied/i);

  const message = await rpc(B, "public.crm_chat_send($1,$2)", [direct.id,"  Olá, Carlos!  "]);
  ok(message.senderId === B && message.senderName === "Bruna" && message.body === "Olá, Carlos!", "sender identity is generated from verified actor");
  ok((await rpc(B, "public.crm_chat_list()")).totalUnread === 0, "own messages do not count as unread");
  ok((await rpc(C, "public.crm_chat_list()")).totalUnread === 1, "recipient sees unread message");
  const marked = await rpc(C, "public.crm_chat_mark_read($1)", [direct.id]);
  ok(marked.ok && marked.lastReadAt && (await rpc(C, "public.crm_chat_list()")).totalUnread === 0, "mark-read uses server time");
  await fails(() => rpc(A, "public.crm_chat_mark_read($1)", [direct.id]), /participa/i);
  await fails(() => rpc(C, "public.crm_chat_edit($1,$2)", [message.id,"forged edit"]), /somente suas/i);
  await fails(() => rpc(A, "public.crm_chat_delete($1)", [message.id]), /participa/i);
  const edited = await rpc(B, "public.crm_chat_edit($1,$2)", [message.id,"Mensagem corrigida"]);
  ok(edited.body === "Mensagem corrigida" && !!edited.editedAt && edited.createdAt === message.createdAt, "own edit preserves timestamp and sets edit time");
  await rpc(B, "public.crm_chat_delete($1)", [message.id]);
  const tombstone = (await rpc(C, "public.crm_chat_history($1)", [direct.id]))[0];
  ok(tombstone.body === "" && !!tombstone.deletedAt, "deleted messages clear their body and retain realtime tombstone");
  await fails(() => rpc(B, "public.crm_chat_edit($1,$2)", [message.id,"restore"]), /somente suas/i);
  ok((await rpc(B, "public.crm_chat_delete($1)", [message.id])).ok, "message delete is idempotent");
  await fails(() => rpc(B, "public.crm_chat_send($1,$2)", [team.id," ".repeat(2)]), /caracteres/i);
  await fails(() => rpc(B, "public.crm_chat_send($1,$2)", [team.id,"x".repeat(4001)]), /caracteres/i);
  await fails(() => actor(C, () => db.query("update public.crm_chat_reads set last_read_at='2100-01-01'")), /permission denied/i);
  const teamMessage = await rpc(C, "public.crm_chat_send($1,$2)", [team.id,"Mensagem de equipe"]);
  await fails(() => rpc(M, "public.crm_chat_delete($1)", [teamMessage.id]), /não pode/i);
  await rpc(A, "public.crm_chat_delete($1)", [teamMessage.id]);
  ok((await rpc(B, "public.crm_chat_history($1)", [team.id]))[0].deletedAt !== null, "admin moderates team messages");

  const tieDate = "2026-01-01T12:00:00Z";
  const messageIds = ["90000000-0000-4000-8000-000000000001","90000000-0000-4000-8000-000000000002","90000000-0000-4000-8000-000000000003"];
  for (const id of messageIds) await db.query("insert into public.crm_chat_messages(id,workspace_id,conversation_id,sender_id,sender_name,body,created_at)values($1,$2,$3,$4,'Bruna','Tie',$5)", [id,TEAM,direct.id,B,tieDate]);
  const tiedMessages = await rpc(C, "public.crm_chat_history($1,$2,$3,2)", [direct.id,"2026-01-01T12:00:00.001Z","ffffffff-ffff-4fff-8fff-ffffffffffff"]);
  ok(tiedMessages.map((item)=>item.id).join(",") === messageIds.slice(1).reverse().join(","), "message history uses stable ID order for equal timestamps");
  const olderMessage = await rpc(C, "public.crm_chat_history($1,$2,$3,2)", [direct.id,tiedMessages[1].createdAt,tiedMessages[1].id]);
  ok(olderMessage[0].id === messageIds[0], "message cursor never skips timestamp collisions");
  await fails(() => rpc(B, "public.crm_chat_history($1,null,null,52)", [direct.id]), /Paginação/i);
  await fails(() => rpc(B, "public.crm_chat_history($1,now(),null,2)", [direct.id]), /Paginação/i);

  const post = await rpc(B, "public.crm_feed_create($1)", ["Bom dia, equipe!"]);
  ok(post.authorId === B && post.authorName === "Bruna" && post.commentCount === 0, "feed stores actor identity");
  ok((await rpc(A,"public.crm_feed_list()")).some((item)=>item.id===post.id), "administrators and colleagues share feed");
  ok((await rpc(O,"public.crm_feed_list()")).length===0, "feed is isolated between organizations");
  await fails(() => rpc(O,"public.crm_feed_comment_create($1,$2)",[post.id,"cross organization"]),/não encontrada/i);
  await fails(() => rpc(A,"public.crm_feed_edit($1,$2)",[post.id,"admin rewriting author"]),/somente suas/i);
  const editPost = await rpc(B,"public.crm_feed_edit($1,$2)",[post.id,"Atualização da equipe"]);
  ok(editPost.body==="Atualização da equipe" && !!editPost.editedAt, "author edits own post");
  await fails(() => rpc(B,"public.crm_feed_pin($1,true)",[post.id]),/administradores/i);
  const pinned = await rpc(A,"public.crm_feed_pin($1,true)",[post.id]);
  ok(pinned.pinned, "administrator pins announcements");
  await fails(() => actor(B,()=>db.query("update public.crm_feed_posts set pinned=true where id=$1",[post.id])),/permission denied/i);
  await fails(() => actor(B,()=>db.query("insert into public.crm_feed_posts(workspace_id,author_id,author_name,body)values($1,$2,'Admin','Spoof')",[TEAM,A])),/permission denied/i);
  const comment = await rpc(C,"public.crm_feed_comment_create($1,$2)",[post.id,"Muito bom!"]);
  ok(comment.authorId===C && comment.authorName==="Carlos", "comments use real actor snapshot");
  ok((await rpc(B,"public.crm_feed_list()"))[0].commentCount===1, "comment counts are computed from rows");
  await fails(() => rpc(B,"public.crm_feed_comment_edit($1,$2)",[comment.id,"forged"]),/somente seus/i);
  const updatedComment = await rpc(C,"public.crm_feed_comment_edit($1,$2)",[comment.id,"Excelente!"]);
  ok(updatedComment.body==="Excelente!" && updatedComment.editedAt, "author edits comment");
  await rpc(B,"public.crm_feed_react($1,$2)",[post.id,"like"]);
  const originalReaction = await one("select id from public.crm_feed_reactions where post_id=$1 and user_id=$2", [post.id,B]);
  let reacted = await rpc(B,"public.crm_feed_react($1,$2)",[post.id,"like"]);
  ok(reacted.reactions.like===1 && reacted.myReaction==="like", "repeated reaction assignment does not double-count");
  reacted = await rpc(B,"public.crm_feed_react($1,$2)",[post.id,"heart"]);
  ok(reacted.reactions.like===0 && reacted.reactions.heart===1 && reacted.myReaction==="heart", "reaction replacement is atomic");
  reacted = await rpc(C,"public.crm_feed_react($1,$2)",[post.id,"celebrate"]);
  ok(reacted.reactions.heart===1 && reacted.reactions.celebrate===1, "different collaborators react independently");
  reacted = await rpc(B,"public.crm_feed_react($1,null)",[post.id]);
  ok(reacted.reactions.heart===0 && reacted.myReaction===null, "explicit null removes current reaction");
  const reactionTombstone = await one("select id,reaction from public.crm_feed_reactions where post_id=$1 and user_id=$2", [post.id,B]);
  ok(reactionTombstone?.id === originalReaction.id && reactionTombstone.reaction === null, "reaction removal updates an existing tombstone instead of emitting DELETE");
  reacted = await rpc(B,"public.crm_feed_react($1,$2)",[post.id,"like"]);
  ok(reacted.reactions.like === 1 && reacted.myReaction === 'like', "a cleared reaction can be added again");
  reacted = await rpc(B,"public.crm_feed_react($1,null)",[post.id]);
  ok(reacted.reactions.like === 0 && reacted.myReaction === null && (await one("select id from public.crm_feed_reactions where post_id=$1 and user_id=$2", [post.id,B])).id === originalReaction.id, "repeated reaction removal preserves opaque row identity and zero counts");
  await fails(() => rpc(B,"public.crm_feed_react($1,$2)",[post.id,"other"]),/reação/i);
  await fails(() => actor(B,()=>db.query("insert into public.crm_feed_reactions(post_id,user_id,workspace_id,reaction) values($1,$2,$3,'like')",[post.id,A,TEAM])),/permission denied/i);
  await rpc(A,"public.crm_feed_comment_delete($1)",[comment.id]);
  ok((await rpc(B,"public.crm_feed_comments($1)",[post.id])).length===0, "admin moderates comments");
  ok((await one("select body from public.crm_feed_comments where id=$1",[comment.id])).body==="", "comment deletion clears content");
  await fails(() => rpc(M,"public.crm_feed_delete($1)",[post.id]),/não pode/i);

  const older = await rpc(C,"public.crm_feed_create($1)",["Aviso antigo"]);
  const newer = await rpc(C,"public.crm_feed_create($1)",["Publicação nova"]);
  await db.query("update public.crm_feed_posts set created_at='2020-01-01' where id=$1",[older.id]);
  await rpc(A,"public.crm_feed_pin($1,true)",[older.id]);
  let feed = await rpc(B,"public.crm_feed_list(null,null,null,2)");
  ok(feed.every((item)=>item.pinned) && feed.some((item)=>item.id===older.id), "old pinned announcements are included in the first page");
  const next = await rpc(B,"public.crm_feed_list($1,$2,$3,2)",[feed[1].pinned,feed[1].createdAt,feed[1].id]);
  ok(next.some((item)=>item.id===newer.id), "feed cursor crosses from pinned to regular posts");
  const tiePosts = ["91000000-0000-4000-8000-000000000001","91000000-0000-4000-8000-000000000002","91000000-0000-4000-8000-000000000003"];
  for (const id of tiePosts) await db.query("insert into public.crm_feed_posts(id,workspace_id,author_id,author_name,body,created_at)values($1,$2,$3,'Bruna','Same time',$4)",[id,TEAM,B,tieDate]);
  feed = await rpc(C,"public.crm_feed_list(false,$1,$2,2)",["2026-01-01T12:00:00.001Z","ffffffff-ffff-4fff-8fff-ffffffffffff"]);
  ok(feed.map((item)=>item.id).join(",")===tiePosts.slice(1).reverse().join(","), "feed uses stable composite cursor");
  const lastTied = await rpc(C,"public.crm_feed_list(false,$1,$2,2)",[feed[1].createdAt,feed[1].id]);
  ok(lastTied[0].id===tiePosts[0], "feed pagination preserves every equal-time post");
  await fails(() => rpc(B,"public.crm_feed_list(null,now(),null,2)"),/Paginação/i);
  const commentDates = ["92000000-0000-4000-8000-000000000001","92000000-0000-4000-8000-000000000002"];
  for (const id of commentDates) await db.query("insert into public.crm_feed_comments(id,workspace_id,post_id,author_id,author_name,body,created_at)values($1,$2,$3,$4,'Bruna','Same time',$5)",[id,TEAM,newer.id,B,tieDate]);
  const comments = await rpc(C,"public.crm_feed_comments($1,null,null,1)",[newer.id]);
  const nextComment = await rpc(C,"public.crm_feed_comments($1,$2,$3,1)",[newer.id,comments[0].createdAt,comments[0].id]);
  ok(comments[0].id===commentDates[1] && nextComment[0].id===commentDates[0], "comment pagination preserves equal timestamps");
  await rpc(A,"public.crm_feed_delete($1)",[post.id]);
  ok(!(await rpc(B,"public.crm_feed_list()")).some((item)=>item.id===post.id), "deleted publication disappears from feed");
  ok((await one("select body from public.crm_feed_posts where id=$1",[post.id])).body==="", "post deletion clears its content");
  await fails(() => rpc(C,"public.crm_feed_comment_create($1,$2)",[post.id,"After delete"]),/não encontrada/i);
  await fails(() => rpc(C,"public.crm_feed_react($1,$2)",[post.id,"like"]),/não encontrada/i);
  ok((await actor(C,()=>db.query("select * from public.crm_feed_comments where post_id=$1",[post.id]))).rows.length===0, "comments under removed posts are not exposed directly");
  await fails(() => rpc(B,"public.crm_feed_create($1)",["x".repeat(8001)]),/caracteres/i);
  await fails(() => rpc(B,"public.crm_feed_comment_create($1,$2)",[newer.id,"x".repeat(2001)]),/caracteres/i);

  await db.query("update public.crm_members set active=false where user_id=$1",[C]);
  await fails(() => rpc(C,"public.crm_chat_history($1)",[direct.id]),/participa/i);
  await fails(() => rpc(C,"public.crm_chat_send($1,$2)",[direct.id,"suspended"]),/participa/i);
  await fails(() => rpc(C,"public.crm_feed_list()"),/liberado/i);
  ok((await actor(C,()=>db.query("select * from public.crm_chat_messages"))).rows.length===0, "suspended member receives no realtime-readable messages");
  ok((await actor(C,()=>db.query("select * from public.crm_feed_posts"))).rows.length===0, "suspended member receives no feed rows");
  await db.query("update public.crm_members set active=true where user_id=$1",[C]);
  const before = await one("select (select count(*) from public.crm_chat_messages)::int messages,(select count(*) from public.crm_feed_posts)::int posts");
  await db.exec(SQL[2]);
  const after = await one("select (select count(*) from public.crm_chat_messages)::int messages,(select count(*) from public.crm_feed_posts)::int posts");
  ok(before.messages===after.messages && before.posts===after.posts, "reapplying migration preserves collaboration history");
  ok((await one("select payload->>'name' name from public.crm_records where id='preserved'")).name==="Existing business record", "collaboration migration preserves CRM data");
  ok((await rpc(B,"public.crm_chat_open($1)",[C])).id===direct.id, "idempotent migration preserves direct pair identity");
  console.log(JSON.stringify({status:"passed",checks,engine:"PostgreSQL/PGlite",limitations:"Supabase Auth roles/users are locally emulated; no remote API or email used."}));
} finally {
  await db.close();
}
