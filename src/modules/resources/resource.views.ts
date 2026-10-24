import { resources } from "../../infrastructure/database/schema";

/** Columns of API Contract v1.6 `ResourceAdminView` (every field the Admin UI needs, incl. stateVersion). */
export const resourceAdminColumns = {
  id: resources.id,
  title: resources.title,
  category: resources.category,
  tags: resources.tags,
  content: resources.content,
  status: resources.status,
  featured: resources.featured,
  publishedAt: resources.publishedAt,
  stateVersion: resources.stateVersion,
  createdAt: resources.createdAt,
  updatedAt: resources.updatedAt,
};

export interface ResourceAdminRow {
  id: string;
  title: string;
  category: string;
  tags: string[];
  content: unknown;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  featured: boolean;
  publishedAt: Date | null;
  stateVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * API Contract v1.6 `ResourceView` — exactly id, title, category, tags,
 * content, featured, publishedAt. Never status, stateVersion or timestamps;
 * callers only ever pass PUBLISHED rows.
 */
export function toResourceView(row: ResourceAdminRow) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    tags: row.tags,
    content: row.content,
    featured: row.featured,
    publishedAt: row.publishedAt,
  };
}

/** API Contract v1.6 `ResourceAdminView` — Admin-only management projection. */
export function toResourceAdminView(row: ResourceAdminRow) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    tags: row.tags,
    content: row.content,
    status: row.status,
    featured: row.featured,
    publishedAt: row.publishedAt,
    stateVersion: row.stateVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
