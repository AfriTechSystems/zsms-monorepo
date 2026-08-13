/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced by: supabase gen types typescript --linked > packages/types/src/database.ts
 * Regenerate after every migration (CONVENTIONS.md prohibition 3).
 *
 * Placeholder until the first table migration lands (0003). The public schema
 * currently holds zero tables — only the seven RLS helper functions from 0001.
 */
export type Json = string | number | boolean | null | { [k: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: Record<string, never>
    Views: Record<string, never>
    Functions: {
      get_school_id: { Args: Record<string, never>; Returns: string }
      get_user_role: { Args: Record<string, never>; Returns: string }
      get_user_id: { Args: Record<string, never>; Returns: string }
      is_afritech_admin: { Args: Record<string, never>; Returns: boolean }
      is_impersonation_session: { Args: Record<string, never>; Returns: boolean }
      get_actor_id: { Args: Record<string, never>; Returns: string }
      has_permission_grant: { Args: { p_module: string; p_action: string }; Returns: boolean }
    }
    Enums: Record<string, never>
  }
}
