export type Stage =
  | "new"
  | "qualified"
  | "proposal"
  | "negotiation"
  | "won"
  | "lost";
export type Collection = "companies" | "contacts" | "deals" | "tasks";
export type Page =
  | "overview"
  | "deals"
  | "contacts"
  | "companies"
  | "tasks"
  | "chat"
  | "feed"
  | "leads"
  | "automations"
  | "billing"
  | "contact-center"
  | "projects"
  | "calendar"
  | "people"
  | "processes"
  | "copilot"
  | "app-settings"
  | "profile"
  | "settings";
export type Role = "admin" | "manager" | "user";
export type PermissionScope = "none" | "own" | "all";
export interface ModulePermissions {
  read: PermissionScope;
  create: boolean;
  update: PermissionScope;
  delete: PermissionScope;
  export: boolean;
}
export type PermissionProfile = Record<Collection, ModulePermissions>;
export interface CRMMember {
  userId: string;
  email?: string;
  displayName: string;
  role: Role;
  active: boolean;
}
export interface CRMAccess {
  storage: "sqlite" | "supabase";
  userId: string;
  workspaceId: string | null;
  workspaceName: string;
  role: Role | null;
  permissions: PermissionProfile;
  members: CRMMember[];
  profiles: Record<Role, PermissionProfile>;
}

export interface Company {
  id: string;
  ownerId?: string;
  name: string;
  sector: string;
  website: string;
  phone: string;
  owner: string;
}

export interface Contact {
  id: string;
  ownerId?: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  companyId: string;
  owner: string;
}

export interface Deal {
  id: string;
  ownerId?: string;
  title: string;
  value: number;
  stage: Stage;
  companyId: string;
  contactId: string;
  owner: string;
  dueDate: string;
  description: string;
}

export interface Task {
  id: string;
  ownerId?: string;
  title: string;
  dueDate: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "done";
  owner: string;
  dealId: string;
}

export interface Activity {
  id: string;
  text: string;
  createdAt: string;
  type: string;
}

export interface CRMState {
  companies: Company[];
  contacts: Contact[];
  deals: Deal[];
  tasks: Task[];
  activities: Activity[];
}

export type Entity = Company | Contact | Deal | Task;

export interface Editor {
  collection: Collection;
  entity?: Entity;
  initial?: Record<string, string>;
}
