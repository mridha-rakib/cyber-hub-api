import { employers, users } from "../../infrastructure/database/schema";

/**
 * Wave 7A Admin account-management projections. API Contract v1.5 names no
 * dedicated Admin user/employer view, so these are the smallest safe
 * projections of the API-ADM-001/002 ("safe account-management
 * projection"; "no blanket private portfolio evidence") and API-ADM-004/005
 * rows. Columns are selected explicitly: password_hash, email_normalized,
 * auth_version and the source-limited `profile` JSON are never read.
 */
export const adminUserColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  verified: users.verified,
  verifiedAt: users.verifiedAt,
  employerId: users.employerId,
  deletionRequestedAt: users.deletionRequestedAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

export const adminEmployerColumns = {
  id: employers.id,
  companyName: employers.companyName,
  email: employers.email,
  status: employers.status,
  createdAt: employers.createdAt,
  updatedAt: employers.updatedAt,
};

interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  verified: boolean;
  verifiedAt: Date | null;
  employerId: string | null;
  deletionRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface AdminEmployerRow {
  id: string;
  companyName: string;
  email: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

export function toAdminUserView(row: AdminUserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    verified: row.verified,
    verifiedAt: iso(row.verifiedAt),
    employerId: row.employerId,
    deletionRequestedAt: iso(row.deletionRequestedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAdminEmployerView(row: AdminEmployerRow) {
  return {
    id: row.id,
    companyName: row.companyName,
    email: row.email,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Linked accounts on API-ADM-005 (DB touchpoint "employers, users"). */
export function toEmployerMemberView(row: AdminUserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    verified: row.verified,
    createdAt: row.createdAt.toISOString(),
  };
}
