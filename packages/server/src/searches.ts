import { z } from 'zod'
import type { Database as Db } from 'better-sqlite3'

/**
 * Saved searches — FR-FIND-6.
 *
 * A structured query is the fastest way to find one stub among thousands, and it is also the
 * thing nobody remembers the syntax of a week later. `method:POST status:5xx header:X-Tenant`
 * is worth keeping once someone has worked it out.
 *
 * Per profile, because a query naming a header or a folder means nothing on a server that has
 * neither, and offering it there would be an invitation to an empty result.
 *
 * These are the one piece of state Mock Knight owns rather than mirrors: deleting the database
 * loses them, and nothing upstream can recreate them. That is a deliberate limit — they are a
 * convenience, not a document, and §9.7's file sync is where shareable things belong.
 */

export const savedSearchInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  query: z.string().min(1).max(2000),
})
export type SavedSearchInput = z.infer<typeof savedSearchInputSchema>

export interface SavedSearch extends SavedSearchInput {
  id: number
}

export function listSavedSearches(db: Db, profileId: string): SavedSearch[] {
  return db
    .prepare(`SELECT id, name, query FROM saved_search WHERE profile_id = ? ORDER BY name`)
    .all(profileId) as SavedSearch[]
}

/**
 * Save, or replace a save of the same name.
 *
 * Upsert rather than reject: someone refining a query and saving it again under the same name
 * means "update this", and a uniqueness error there would be the tool arguing with an obvious
 * intention.
 */
export function saveSearch(db: Db, profileId: string, input: SavedSearchInput): SavedSearch {
  db.prepare(
    `INSERT INTO saved_search (profile_id, name, query) VALUES (@profile_id, @name, @query)
     ON CONFLICT (profile_id, name) DO UPDATE SET query = excluded.query`,
  ).run({ profile_id: profileId, name: input.name, query: input.query })
  return db
    .prepare(`SELECT id, name, query FROM saved_search WHERE profile_id = ? AND name = ?`)
    .get(profileId, input.name) as SavedSearch
}

export function deleteSavedSearch(db: Db, profileId: string, id: number): boolean {
  return (
    db.prepare(`DELETE FROM saved_search WHERE profile_id = ? AND id = ?`).run(profileId, id)
      .changes > 0
  )
}
