export type FeedReaction = "like" | "celebrate" | "heart";

export interface FeedPost {
  id: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  pinned: boolean;
  commentCount: number;
  reactions: Record<FeedReaction, number>;
  myReaction: FeedReaction | null;
}

export interface FeedComment {
  id: string;
  postId: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface FeedPage<T> {
  items: T[];
  nextCursor: string | null;
}
