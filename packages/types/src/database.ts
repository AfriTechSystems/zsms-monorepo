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
      attendance_records: {
        Row: {
          academic_year: string
          arrival_time: string | null
          attendance_date: string
          class_id: string
          created_at: string
          excuse_reason: string | null
          id: string
          local_created_at: string | null
          notification_sent_at: string | null
          parent_notified: boolean
          recorded_by_user_id: string
          school_id: string
          status: string
          student_id: string
          sync_source: string
          term_number: number
          updated_at: string
        }
        Insert: {
          academic_year: string
          arrival_time?: string | null
          attendance_date: string
          class_id: string
          created_at?: string
          excuse_reason?: string | null
          id?: string
          local_created_at?: string | null
          notification_sent_at?: string | null
          parent_notified?: boolean
          recorded_by_user_id: string
          school_id: string
          status: string
          student_id: string
          sync_source?: string
          term_number: number
          updated_at?: string
        }
        Update: {
          academic_year?: string
          arrival_time?: string | null
          attendance_date?: string
          class_id?: string
          created_at?: string
          excuse_reason?: string | null
          id?: string
          local_created_at?: string | null
          notification_sent_at?: string | null
          parent_notified?: boolean
          recorded_by_user_id?: string
          school_id?: string
          status?: string
          student_id?: string
          sync_source?: string
          term_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
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
      exam_results: {
        Row: {
          academic_year: string
          class_id: string
          class_position: number | null
          class_size: number | null
          comments: string | null
          created_at: string
          entered_by_user_id: string
          grade_letter: string | null
          grade_points: number | null
          id: string
          marks_obtained: number | null
          marks_total: number
          published_at: string | null
          results_published: boolean
          school_id: string
          student_id: string
          subject_code: string
          subject_name: string
          sync_source: string
          term_number: number
          updated_at: string
        }
        Insert: {
          academic_year: string
          class_id: string
          class_position?: number | null
          class_size?: number | null
          comments?: string | null
          created_at?: string
          entered_by_user_id: string
          grade_letter?: string | null
          grade_points?: number | null
          id?: string
          marks_obtained?: number | null
          marks_total?: number
          published_at?: string | null
          results_published?: boolean
          school_id: string
          student_id: string
          subject_code: string
          subject_name: string
          sync_source?: string
          term_number: number
          updated_at?: string
        }
        Update: {
          academic_year?: string
          class_id?: string
          class_position?: number | null
          class_size?: number | null
          comments?: string | null
          created_at?: string
          entered_by_user_id?: string
          grade_letter?: string | null
          grade_points?: number | null
          id?: string
          marks_obtained?: number | null
          marks_total?: number
          published_at?: string | null
          results_published?: boolean
          school_id?: string
          student_id?: string
          subject_code?: string
          subject_name?: string
          sync_source?: string
          term_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_results_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_results_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_record_revisions: {
        Row: {
          fee_record_id: string
          id: string
          new_amount: number
          old_amount: number
          reason: string
          revised_at: string
          revised_by: string
          school_id: string
        }
        Insert: {
          fee_record_id: string
          id?: string
          new_amount: number
          old_amount: number
          reason: string
          revised_at?: string
          revised_by: string
          school_id: string
        }
        Update: {
          fee_record_id?: string
          id?: string
          new_amount?: number
          old_amount?: number
          reason?: string
          revised_at?: string
          revised_by?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_record_revisions_fee_record_id_fkey"
            columns: ["fee_record_id"]
            isOneToOne: false
            referencedRelation: "fee_record_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_record_revisions_fee_record_id_fkey"
            columns: ["fee_record_id"]
            isOneToOne: false
            referencedRelation: "fee_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_record_revisions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_records: {
        Row: {
          academic_year: string
          amount_due: number
          amount_paid: number
          created_at: string
          currency_code: string
          deleted_at: string | null
          discount_amount: number
          discount_reason: string | null
          due_date: string | null
          fee_label: string
          fee_structure_id: string
          id: string
          is_deleted: boolean
          last_reminder_at: string | null
          reminder_count: number
          school_id: string
          status: string
          student_id: string
          term_number: number
          updated_at: string
        }
        Insert: {
          academic_year: string
          amount_due: number
          amount_paid?: number
          created_at?: string
          currency_code?: string
          deleted_at?: string | null
          discount_amount?: number
          discount_reason?: string | null
          due_date?: string | null
          fee_label: string
          fee_structure_id: string
          id?: string
          is_deleted?: boolean
          last_reminder_at?: string | null
          reminder_count?: number
          school_id: string
          status?: string
          student_id: string
          term_number: number
          updated_at?: string
        }
        Update: {
          academic_year?: string
          amount_due?: number
          amount_paid?: number
          created_at?: string
          currency_code?: string
          deleted_at?: string | null
          discount_amount?: number
          discount_reason?: string | null
          due_date?: string | null
          fee_label?: string
          fee_structure_id?: string
          id?: string
          is_deleted?: boolean
          last_reminder_at?: string | null
          reminder_count?: number
          school_id?: string
          status?: string
          student_id?: string
          term_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_records_fee_structure_id_fkey"
            columns: ["fee_structure_id"]
            isOneToOne: false
            referencedRelation: "fee_structures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_records_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_structures: {
        Row: {
          academic_year: string
          amount: number
          created_at: string
          currency_code: string
          fee_label: string
          grade_id: string
          id: string
          is_active: boolean
          is_mandatory: boolean
          school_id: string
          student_type: string
          term_number: number
          updated_at: string
        }
        Insert: {
          academic_year: string
          amount: number
          created_at?: string
          currency_code?: string
          fee_label?: string
          grade_id: string
          id?: string
          is_active?: boolean
          is_mandatory?: boolean
          school_id: string
          student_type?: string
          term_number: number
          updated_at?: string
        }
        Update: {
          academic_year?: string
          amount?: number
          created_at?: string
          currency_code?: string
          fee_label?: string
          grade_id?: string
          id?: string
          is_active?: boolean
          is_mandatory?: boolean
          school_id?: string
          student_type?: string
          term_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_structures_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
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
      payment_gateways: {
        Row: {
          api_key_encrypted: string | null
          api_secret_encrypted: string | null
          created_at: string
          display_name: string
          gateway_config: Json
          gateway_name: string
          id: string
          is_active: boolean
          is_primary: boolean
          merchant_id: string | null
          school_id: string
          supported_currencies: string[]
          test_mode: boolean
          updated_at: string
          webhook_secret: string | null
        }
        Insert: {
          api_key_encrypted?: string | null
          api_secret_encrypted?: string | null
          created_at?: string
          display_name: string
          gateway_config?: Json
          gateway_name: string
          id?: string
          is_active?: boolean
          is_primary?: boolean
          merchant_id?: string | null
          school_id: string
          supported_currencies?: string[]
          test_mode?: boolean
          updated_at?: string
          webhook_secret?: string | null
        }
        Update: {
          api_key_encrypted?: string | null
          api_secret_encrypted?: string | null
          created_at?: string
          display_name?: string
          gateway_config?: Json
          gateway_name?: string
          id?: string
          is_active?: boolean
          is_primary?: boolean
          merchant_id?: string | null
          school_id?: string
          supported_currencies?: string[]
          test_mode?: boolean
          updated_at?: string
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_gateways_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          bank_name: string | null
          cheque_number: string | null
          confirmation_checkbox_at: string | null
          created_at: string
          currency_code: string
          fee_record_id: string
          gateway_name: string | null
          gateway_reference: string | null
          gateway_transaction_id: string | null
          id: string
          is_voided: boolean
          notes: string | null
          paid_at: string
          payment_method: string
          proof_of_payment_url: string | null
          receipt_number: string
          receipt_url: string | null
          recorded_by_user_id: string
          rejection_reason: string | null
          reversal_of_payment_id: string | null
          school_id: string
          status: string
          student_id: string
          verified_at: string | null
          verified_by: string | null
          webhook_verified: boolean
        }
        Insert: {
          amount: number
          bank_name?: string | null
          cheque_number?: string | null
          confirmation_checkbox_at?: string | null
          created_at?: string
          currency_code?: string
          fee_record_id: string
          gateway_name?: string | null
          gateway_reference?: string | null
          gateway_transaction_id?: string | null
          id?: string
          is_voided?: boolean
          notes?: string | null
          paid_at?: string
          payment_method: string
          proof_of_payment_url?: string | null
          receipt_number: string
          receipt_url?: string | null
          recorded_by_user_id: string
          rejection_reason?: string | null
          reversal_of_payment_id?: string | null
          school_id: string
          status?: string
          student_id: string
          verified_at?: string | null
          verified_by?: string | null
          webhook_verified?: boolean
        }
        Update: {
          amount?: number
          bank_name?: string | null
          cheque_number?: string | null
          confirmation_checkbox_at?: string | null
          created_at?: string
          currency_code?: string
          fee_record_id?: string
          gateway_name?: string | null
          gateway_reference?: string | null
          gateway_transaction_id?: string | null
          id?: string
          is_voided?: boolean
          notes?: string | null
          paid_at?: string
          payment_method?: string
          proof_of_payment_url?: string | null
          receipt_number?: string
          receipt_url?: string | null
          recorded_by_user_id?: string
          rejection_reason?: string | null
          reversal_of_payment_id?: string | null
          school_id?: string
          status?: string
          student_id?: string
          verified_at?: string | null
          verified_by?: string | null
          webhook_verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "payments_fee_record_id_fkey"
            columns: ["fee_record_id"]
            isOneToOne: false
            referencedRelation: "fee_record_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_fee_record_id_fkey"
            columns: ["fee_record_id"]
            isOneToOne: false
            referencedRelation: "fee_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_reversal_of_payment_id_fkey"
            columns: ["reversal_of_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
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
      report_generation_jobs: {
        Row: {
          academic_year: string
          class_id: string
          completed_students: number
          created_at: string
          error_message: string | null
          id: string
          run_id: string
          school_id: string
          status: string
          term_number: number
          total_students: number
          updated_at: string
        }
        Insert: {
          academic_year: string
          class_id: string
          completed_students?: number
          created_at?: string
          error_message?: string | null
          id?: string
          run_id: string
          school_id: string
          status?: string
          term_number: number
          total_students?: number
          updated_at?: string
        }
        Update: {
          academic_year?: string
          class_id?: string
          completed_students?: number
          created_at?: string
          error_message?: string | null
          id?: string
          run_id?: string
          school_id?: string
          status?: string
          term_number?: number
          total_students?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_generation_jobs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
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
      fee_record_status: {
        Row: {
          academic_year: string | null
          amount_due: number | null
          amount_paid: number | null
          currency_code: string | null
          days_overdue: number | null
          discount_amount: number | null
          due_date: string | null
          fee_label: string | null
          id: string | null
          is_overdue: boolean | null
          outstanding: number | null
          school_id: string | null
          status: string | null
          student_id: string | null
          term_number: number | null
        }
        Insert: {
          academic_year?: string | null
          amount_due?: number | null
          amount_paid?: number | null
          currency_code?: string | null
          days_overdue?: never
          discount_amount?: number | null
          due_date?: string | null
          fee_label?: string | null
          id?: string | null
          is_overdue?: never
          outstanding?: never
          school_id?: string | null
          status?: string | null
          student_id?: string | null
          term_number?: number | null
        }
        Update: {
          academic_year?: string | null
          amount_due?: number | null
          amount_paid?: number | null
          currency_code?: string | null
          days_overdue?: never
          discount_amount?: number | null
          due_date?: string | null
          fee_label?: string | null
          id?: string | null
          is_overdue?: never
          outstanding?: never
          school_id?: string | null
          status?: string | null
          student_id?: string | null
          term_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fee_records_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_fee_balance: {
        Row: {
          arrears_amount: number | null
          currency_code: string | null
          days_overdue: number | null
          first_name: string | null
          is_overdue: boolean | null
          last_name: string | null
          oldest_unpaid_due_date: string | null
          outstanding: number | null
          records_outstanding: number | null
          records_overdue: number | null
          records_total: number | null
          school_id: string | null
          student_code: string | null
          student_id: string | null
          student_status: string | null
          total_discount: number | null
          total_due: number | null
          total_paid: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fee_records_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      allocate_payment: {
        Args: {
          p_allocations?: Json
          p_amount: number
          p_notes?: string
          p_payment_method: string
          p_proof_url?: string
          p_student_id: string
        }
        Returns: {
          out_amount: number
          out_fee_record_id: string
          out_payment_id: string
          out_receipt_number: string
        }[]
      }
      current_school_uuid: { Args: never; Returns: string }
      fee_statement: {
        Args: { p_from?: string; p_student_id: string; p_to?: string }
        Returns: {
          credit: number
          debit: number
          description: string
          entry_date: string
          entry_type: string
          reference: string
          running_balance: number
        }[]
      }
      generate_fee_records: {
        Args: {
          p_academic_year: string
          p_due_date?: string
          p_term_number: number
        }
        Returns: {
          created_count: number
          skipped_count: number
        }[]
      }
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
      is_own_student_record: {
        Args: { p_student_id: string }
        Returns: boolean
      }
      parent_can_access_fee_record: {
        Args: { p_fee_record_id: string }
        Returns: boolean
      }
      parent_has_child_at_school: {
        Args: { p_school_id: string }
        Returns: boolean
      }
      parent_has_student_in_current_school: {
        Args: { p_parent_id: string }
        Returns: boolean
      }
      publish_results: {
        Args: {
          p_academic_year: string
          p_class_id?: string
          p_term_number: number
        }
        Returns: number
      }
      revise_fee_records: {
        Args: {
          p_academic_year: string
          p_fee_label: string
          p_new_amount: number
          p_reason: string
          p_term_number: number
        }
        Returns: {
          revised_count: number
          skipped_count: number
        }[]
      }
      student_in_current_school: {
        Args: { p_student_id: string }
        Returns: boolean
      }
      suggest_payment_allocation: {
        Args: { p_amount: number; p_student_id: string }
        Returns: {
          academic_year: string
          due_date: string
          fee_label: string
          fee_record_id: string
          outstanding: number
          suggested: number
          term_number: number
        }[]
      }
      teacher_reaches_class: { Args: { p_class_id: string }; Returns: boolean }
      teacher_teaches_subject: {
        Args: { p_class_id: string; p_subject_code: string }
        Returns: boolean
      }
      verify_payment: {
        Args: { p_decision: string; p_payment_id: string; p_reason?: string }
        Returns: {
          amount: number
          bank_name: string | null
          cheque_number: string | null
          confirmation_checkbox_at: string | null
          created_at: string
          currency_code: string
          fee_record_id: string
          gateway_name: string | null
          gateway_reference: string | null
          gateway_transaction_id: string | null
          id: string
          is_voided: boolean
          notes: string | null
          paid_at: string
          payment_method: string
          proof_of_payment_url: string | null
          receipt_number: string
          receipt_url: string | null
          recorded_by_user_id: string
          rejection_reason: string | null
          reversal_of_payment_id: string | null
          school_id: string
          status: string
          student_id: string
          verified_at: string | null
          verified_by: string | null
          webhook_verified: boolean
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
