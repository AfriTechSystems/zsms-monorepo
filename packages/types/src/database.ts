export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      class_subjects: {
        Row: {
          academic_year: string
          class_id: string
          created_at: string
          id: string
          is_active: boolean
          school_id: string
          subject_id: string
          updated_at: string
        }
        Insert: {
          academic_year: string
          class_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          school_id: string
          subject_id: string
          updated_at?: string
        }
        Update: {
          academic_year?: string
          class_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          school_id?: string
          subject_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_subjects_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_subjects_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "school_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_checklists: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          is_complete: boolean
          item_key: string
          school_id: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          is_complete?: boolean
          item_key: string
          school_id: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          is_complete?: boolean
          item_key?: string
          school_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_checklists_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      parents: {
        Row: {
          clerk_user_id: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          last_login_at: string | null
          national_id: string | null
          phone_e164: string | null
          preferred_contact: string
          updated_at: string
          whatsapp_opted_in: boolean
        }
        Insert: {
          clerk_user_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          last_login_at?: string | null
          national_id?: string | null
          phone_e164?: string | null
          preferred_contact?: string
          updated_at?: string
          whatsapp_opted_in?: boolean
        }
        Update: {
          clerk_user_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          last_login_at?: string | null
          national_id?: string | null
          phone_e164?: string | null
          preferred_contact?: string
          updated_at?: string
          whatsapp_opted_in?: boolean
        }
        Relationships: []
      }
      reference_subjects_zm: {
        Row: {
          country_code: string
          created_at: string
          curriculum_type: string
          id: string
          is_active: boolean
          is_core: boolean
          level_type: string
          subject_code: string
          subject_name: string
        }
        Insert: {
          country_code?: string
          created_at?: string
          curriculum_type?: string
          id?: string
          is_active?: boolean
          is_core?: boolean
          level_type: string
          subject_code: string
          subject_name: string
        }
        Update: {
          country_code?: string
          created_at?: string
          curriculum_type?: string
          id?: string
          is_active?: boolean
          is_core?: boolean
          level_type?: string
          subject_code?: string
          subject_name?: string
        }
        Relationships: []
      }
      school_academic_config: {
        Row: {
          class_naming_convention: string | null
          created_at: string
          curriculum_type: string
          grading_system: string
          highest_level_offered: string | null
          id: string
          onboarding_complete: boolean
          report_card_format: string | null
          school_id: string
          structure_type: string | null
          updated_at: string
        }
        Insert: {
          class_naming_convention?: string | null
          created_at?: string
          curriculum_type?: string
          grading_system?: string
          highest_level_offered?: string | null
          id?: string
          onboarding_complete?: boolean
          report_card_format?: string | null
          school_id: string
          structure_type?: string | null
          updated_at?: string
        }
        Update: {
          class_naming_convention?: string | null
          created_at?: string
          curriculum_type?: string
          grading_system?: string
          highest_level_offered?: string | null
          id?: string
          onboarding_complete?: boolean
          report_card_format?: string | null
          school_id?: string
          structure_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_academic_config_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_grade_levels: {
        Row: {
          created_at: string
          display_name: string
          examination_type: string
          id: string
          is_active: boolean
          level_id: string
          level_order: number
          level_type: string
          school_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          examination_type?: string
          id?: string
          is_active?: boolean
          level_id: string
          level_order: number
          level_type: string
          school_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          examination_type?: string
          id?: string
          is_active?: boolean
          level_id?: string
          level_order?: number
          level_type?: string
          school_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_grade_levels_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_grading_scales: {
        Row: {
          applies_to_levels: string[]
          created_at: string
          credit_mark: number | null
          grade_bands: Json
          id: string
          is_active: boolean
          pass_mark: number | null
          scale_name: string
          scale_type: string
          school_id: string
          updated_at: string
        }
        Insert: {
          applies_to_levels?: string[]
          created_at?: string
          credit_mark?: number | null
          grade_bands?: Json
          id?: string
          is_active?: boolean
          pass_mark?: number | null
          scale_name: string
          scale_type: string
          school_id: string
          updated_at?: string
        }
        Update: {
          applies_to_levels?: string[]
          created_at?: string
          credit_mark?: number | null
          grade_bands?: Json
          id?: string
          is_active?: boolean
          pass_mark?: number | null
          scale_name?: string
          scale_type?: string
          school_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_grading_scales_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_permissions: {
        Row: {
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_export: boolean
          can_view: boolean
          created_at: string
          id: string
          module: string
          role: string
          school_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_view?: boolean
          created_at?: string
          id?: string
          module: string
          role: string
          school_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_view?: boolean
          created_at?: string
          id?: string
          module?: string
          role?: string
          school_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "school_permissions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_subjects: {
        Row: {
          created_at: string
          curriculum_type: string
          grading_scale_id: string | null
          id: string
          is_active: boolean
          is_core: boolean
          level_type: string
          school_id: string
          subject_code: string
          subject_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          curriculum_type?: string
          grading_scale_id?: string | null
          id?: string
          is_active?: boolean
          is_core?: boolean
          level_type: string
          school_id: string
          subject_code: string
          subject_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          curriculum_type?: string
          grading_scale_id?: string | null
          id?: string
          is_active?: boolean
          is_core?: boolean
          level_type?: string
          school_id?: string
          subject_code?: string
          subject_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_school_subjects_grading_scale"
            columns: ["grading_scale_id"]
            isOneToOne: false
            referencedRelation: "school_grading_scales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_subjects_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          address: string | null
          city_code: string
          clerk_org_id: string
          country_code: string
          created_at: string
          email: string | null
          finance_module_enabled: boolean
          id: string
          level: string
          logo_url: string | null
          max_students: number | null
          name: string
          phone: string | null
          school_id: string
          status: string
          subscription_ends_at: string | null
          subscription_tier: string
          trial_ends_at: string | null
          type: string
          updated_at: string
          whatsapp_enabled: boolean
        }
        Insert: {
          address?: string | null
          city_code: string
          clerk_org_id: string
          country_code?: string
          created_at?: string
          email?: string | null
          finance_module_enabled?: boolean
          id?: string
          level: string
          logo_url?: string | null
          max_students?: number | null
          name: string
          phone?: string | null
          school_id: string
          status?: string
          subscription_ends_at?: string | null
          subscription_tier?: string
          trial_ends_at?: string | null
          type: string
          updated_at?: string
          whatsapp_enabled?: boolean
        }
        Update: {
          address?: string | null
          city_code?: string
          clerk_org_id?: string
          country_code?: string
          created_at?: string
          email?: string | null
          finance_module_enabled?: boolean
          id?: string
          level?: string
          logo_url?: string | null
          max_students?: number | null
          name?: string
          phone?: string | null
          school_id?: string
          status?: string
          subscription_ends_at?: string | null
          subscription_tier?: string
          trial_ends_at?: string | null
          type?: string
          updated_at?: string
          whatsapp_enabled?: boolean
        }
        Relationships: []
      }
      staff_assignments: {
        Row: {
          academic_year: string
          class_id: string
          created_at: string
          id: string
          is_class_teacher: boolean
          school_id: string
          staff_user_id: string
          subject_code: string
          term_number: number | null
        }
        Insert: {
          academic_year: string
          class_id: string
          created_at?: string
          id?: string
          is_class_teacher?: boolean
          school_id: string
          staff_user_id: string
          subject_code: string
          term_number?: number | null
        }
        Update: {
          academic_year?: string
          class_id?: string
          created_at?: string
          id?: string
          is_class_teacher?: boolean
          school_id?: string
          staff_user_id?: string
          subject_code?: string
          term_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_assignments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_members: {
        Row: {
          clerk_user_id: string
          created_at: string
          department: string | null
          email: string | null
          employment_type: string
          first_name: string
          id: string
          is_active: boolean
          join_date: string | null
          last_name: string
          phone_e164: string | null
          photo_url: string | null
          school_id: string
          staff_number: string | null
          updated_at: string
        }
        Insert: {
          clerk_user_id: string
          created_at?: string
          department?: string | null
          email?: string | null
          employment_type?: string
          first_name: string
          id?: string
          is_active?: boolean
          join_date?: string | null
          last_name: string
          phone_e164?: string | null
          photo_url?: string | null
          school_id: string
          staff_number?: string | null
          updated_at?: string
        }
        Update: {
          clerk_user_id?: string
          created_at?: string
          department?: string | null
          email?: string | null
          employment_type?: string
          first_name?: string
          id?: string
          is_active?: boolean
          join_date?: string | null
          last_name?: string
          phone_e164?: string | null
          photo_url?: string | null
          school_id?: string
          staff_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_members_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_permission_grants: {
        Row: {
          action: string
          expires_at: string | null
          granted_at: string
          grantee_user_id: string
          grantor_user_id: string
          id: string
          is_active: boolean
          module: string
          reason: string
          revoked_at: string | null
          revoked_by: string | null
          school_id: string
          scope_detail: string | null
        }
        Insert: {
          action: string
          expires_at?: string | null
          granted_at?: string
          grantee_user_id: string
          grantor_user_id: string
          id?: string
          is_active?: boolean
          module: string
          reason: string
          revoked_at?: string | null
          revoked_by?: string | null
          school_id: string
          scope_detail?: string | null
        }
        Update: {
          action?: string
          expires_at?: string | null
          granted_at?: string
          grantee_user_id?: string
          grantor_user_id?: string
          id?: string
          is_active?: boolean
          module?: string
          reason?: string
          revoked_at?: string | null
          revoked_by?: string | null
          school_id?: string
          scope_detail?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_permission_grants_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_requests: {
        Row: {
          clerk_user_id: string
          created_at: string
          email: string | null
          first_name: string
          id: string
          last_name: string
          message: string | null
          phone_e164: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          role_requested: string
          school_id: string
          status: string
          subjects: string[] | null
        }
        Insert: {
          clerk_user_id: string
          created_at?: string
          email?: string | null
          first_name: string
          id?: string
          last_name: string
          message?: string | null
          phone_e164?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          role_requested: string
          school_id: string
          status?: string
          subjects?: string[] | null
        }
        Update: {
          clerk_user_id?: string
          created_at?: string
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string
          message?: string | null
          phone_e164?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          role_requested?: string
          school_id?: string
          status?: string
          subjects?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_requests_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      student_parent_links: {
        Row: {
          created_at: string
          grace_period_ends_at: string | null
          id: string
          is_active: boolean
          is_primary: boolean
          linked_by: string | null
          parent_id: string
          parent_user_id: string | null
          relationship: string
          student_id: string
          unlinked_at: string | null
          unlinked_by: string | null
        }
        Insert: {
          created_at?: string
          grace_period_ends_at?: string | null
          id?: string
          is_active?: boolean
          is_primary?: boolean
          linked_by?: string | null
          parent_id: string
          parent_user_id?: string | null
          relationship?: string
          student_id: string
          unlinked_at?: string | null
          unlinked_by?: string | null
        }
        Update: {
          created_at?: string
          grace_period_ends_at?: string | null
          id?: string
          is_active?: boolean
          is_primary?: boolean
          linked_by?: string | null
          parent_id?: string
          parent_user_id?: string | null
          relationship?: string
          student_id?: string
          unlinked_at?: string | null
          unlinked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_parent_links_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "parents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_parent_links_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          class_id: string
          clerk_user_id: string | null
          created_at: string
          date_of_birth: string | null
          deleted_at: string | null
          deleted_by: string | null
          enrolment_date: string
          first_name: string
          gender: string | null
          grade_id: string
          id: string
          is_boarding: boolean
          is_deleted: boolean
          last_name: string
          nrc_or_birth_cert: string | null
          photo_url: string | null
          school_id: string
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          class_id: string
          clerk_user_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          enrolment_date?: string
          first_name: string
          gender?: string | null
          grade_id: string
          id?: string
          is_boarding?: boolean
          is_deleted?: boolean
          last_name: string
          nrc_or_birth_cert?: string | null
          photo_url?: string | null
          school_id: string
          status?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          class_id?: string
          clerk_user_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          enrolment_date?: string
          first_name?: string
          gender?: string | null
          grade_id?: string
          id?: string
          is_boarding?: boolean
          is_deleted?: boolean
          last_name?: string
          nrc_or_birth_cert?: string | null
          photo_url?: string | null
          school_id?: string
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "students_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_assignments: {
        Row: {
          academic_year: string
          class_id: string
          created_at: string
          id: string
          is_active: boolean
          school_id: string
          scope: string
          subject_id: string | null
          teacher_user_id: string
          term_number: number | null
          updated_at: string
        }
        Insert: {
          academic_year: string
          class_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          school_id: string
          scope: string
          subject_id?: string | null
          teacher_user_id: string
          term_number?: number | null
          updated_at?: string
        }
        Update: {
          academic_year?: string
          class_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          school_id?: string
          scope?: string
          subject_id?: string | null
          teacher_user_id?: string
          term_number?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_assignments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_assignments_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "school_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_school_uuid: { Args: never; Returns: string }
      get_actor_id: { Args: never; Returns: string }
      get_school_id: { Args: never; Returns: string }
      get_user_id: { Args: never; Returns: string }
      get_user_role: { Args: never; Returns: string }
      has_permission_grant: {
        Args: { p_action: string; p_module: string }
        Returns: boolean
      }
      is_afritech_admin: { Args: never; Returns: boolean }
      is_impersonation_session: { Args: never; Returns: boolean }
      is_linked_parent_of: { Args: { p_student_id: string }; Returns: boolean }
      parent_has_student_in_current_school: {
        Args: { p_parent_id: string }
        Returns: boolean
      }
      student_in_current_school: {
        Args: { p_student_id: string }
        Returns: boolean
      }
      teacher_reaches_class: { Args: { p_class_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
