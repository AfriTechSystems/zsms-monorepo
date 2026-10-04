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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_credit_accounts: {
        Row: {
          created_at: string
          id: string
          owner_user_id: string | null
          school_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_user_id?: string | null
          school_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_user_id?: string | null
          school_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_credit_accounts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "ai_credit_accounts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "ai_credit_accounts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_credit_caps: {
        Row: {
          account_id: string
          clerk_user_id: string
          created_at: string
          monthly_credit_cap: number
          updated_at: string
        }
        Insert: {
          account_id: string
          clerk_user_id: string
          created_at?: string
          monthly_credit_cap: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          clerk_user_id?: string
          created_at?: string
          monthly_credit_cap?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_credit_caps_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ai_credit_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_credit_ledger: {
        Row: {
          account_id: string
          actor_user_id: string
          assignment_id: string | null
          cost_usd: number | null
          created_at: string
          credits: number
          expires_at: string | null
          feature_key: string | null
          funded_from: string | null
          id: string
          idempotency_key: string | null
          input_tokens: number | null
          lot_id: string | null
          metadata: Json
          model_name: string | null
          output_tokens: number | null
          reason: string
          reservation_id: string | null
        }
        Insert: {
          account_id: string
          actor_user_id: string
          assignment_id?: string | null
          cost_usd?: number | null
          created_at?: string
          credits: number
          expires_at?: string | null
          feature_key?: string | null
          funded_from?: string | null
          id?: string
          idempotency_key?: string | null
          input_tokens?: number | null
          lot_id?: string | null
          metadata?: Json
          model_name?: string | null
          output_tokens?: number | null
          reason: string
          reservation_id?: string | null
        }
        Update: {
          account_id?: string
          actor_user_id?: string
          assignment_id?: string | null
          cost_usd?: number | null
          created_at?: string
          credits?: number
          expires_at?: string | null
          feature_key?: string | null
          funded_from?: string | null
          id?: string
          idempotency_key?: string | null
          input_tokens?: number | null
          lot_id?: string | null
          metadata?: Json
          model_name?: string | null
          output_tokens?: number | null
          reason?: string
          reservation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_credit_ledger_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ai_credit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_credit_ledger_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "school_credit_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_credit_ledger_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "feature_catalogue"
            referencedColumns: ["feature_key"]
          },
          {
            foreignKeyName: "ai_credit_ledger_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "ai_credit_ledger"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_reads: {
        Row: {
          announcement_id: string
          id: string
          read_at: string
          reader_type: string
          reader_user_id: string
          school_id: string | null
        }
        Insert: {
          announcement_id: string
          id?: string
          read_at?: string
          reader_type: string
          reader_user_id: string
          school_id?: string | null
        }
        Update: {
          announcement_id?: string
          id?: string
          read_at?: string
          reader_type?: string
          reader_user_id?: string
          school_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "announcement_reads_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_reads_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "announcement_reads_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "announcement_reads_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_starters: {
        Row: {
          audience: string | null
          body: string
          created_at: string
          created_by: string | null
          id: string
          importance: string
          is_active: boolean
          label: string
          school_id: string | null
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          audience?: string | null
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          importance?: string
          is_active?: boolean
          label: string
          school_id?: string | null
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          audience?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          importance?: string
          is_active?: boolean
          label?: string
          school_id?: string | null
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_starters_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "announcement_starters_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "announcement_starters_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          body: string
          channels: string[]
          created_at: string
          created_by: string
          id: string
          importance: string
          scheduled_at: string | null
          school_id: string | null
          sent_at: string | null
          status: string
          target_audience: string
          target_ids: string[]
          target_scope: string
          target_type: string
          title: string
          updated_at: string
          whatsapp_jobs_queued: number
        }
        Insert: {
          body: string
          channels?: string[]
          created_at?: string
          created_by: string
          id?: string
          importance?: string
          scheduled_at?: string | null
          school_id?: string | null
          sent_at?: string | null
          status?: string
          target_audience: string
          target_ids?: string[]
          target_scope: string
          target_type: string
          title: string
          updated_at?: string
          whatsapp_jobs_queued?: number
        }
        Update: {
          body?: string
          channels?: string[]
          created_at?: string
          created_by?: string
          id?: string
          importance?: string
          scheduled_at?: string | null
          school_id?: string | null
          sent_at?: string | null
          status?: string
          target_audience?: string
          target_ids?: string[]
          target_scope?: string
          target_type?: string
          title?: string
          updated_at?: string
          whatsapp_jobs_queued?: number
        }
        Relationships: [
          {
            foreignKeyName: "announcements_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "announcements_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "announcements_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
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
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "attendance_records_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
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
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string
          created_at: string
          id: string
          impersonated_user_id: string | null
          ip_address: string | null
          metadata: Json
          new_values: Json | null
          old_values: Json | null
          record_id: string | null
          school_id: string | null
          table_name: string
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_user_id: string
          created_at?: string
          id?: string
          impersonated_user_id?: string | null
          ip_address?: string | null
          metadata?: Json
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          school_id?: string | null
          table_name: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string
          created_at?: string
          id?: string
          impersonated_user_id?: string | null
          ip_address?: string | null
          metadata?: Json
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          school_id?: string | null
          table_name?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "audit_logs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "audit_logs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
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
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "class_subjects_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
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
      curriculum_topics: {
        Row: {
          country_code: string
          created_at: string
          curriculum_type: string
          display_order: number
          grade_level: string
          id: string
          is_active: boolean
          learning_outcomes: string[]
          source: string
          source_url: string | null
          sub_topics: string[]
          subject: string
          suggested_periods: number | null
          syllabus_year: number | null
          topic_code: string
          topic_name: string
          updated_at: string
        }
        Insert: {
          country_code?: string
          created_at?: string
          curriculum_type: string
          display_order?: number
          grade_level: string
          id?: string
          is_active?: boolean
          learning_outcomes?: string[]
          source: string
          source_url?: string | null
          sub_topics?: string[]
          subject: string
          suggested_periods?: number | null
          syllabus_year?: number | null
          topic_code: string
          topic_name: string
          updated_at?: string
        }
        Update: {
          country_code?: string
          created_at?: string
          curriculum_type?: string
          display_order?: number
          grade_level?: string
          id?: string
          is_active?: boolean
          learning_outcomes?: string[]
          source?: string
          source_url?: string | null
          sub_topics?: string[]
          subject?: string
          suggested_periods?: number | null
          syllabus_year?: number | null
          topic_code?: string
          topic_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      data_erasure_requests: {
        Row: {
          action_after: string
          email: string | null
          id: string
          reason: string | null
          requested_at: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          subject_kind: string
          user_id: string
        }
        Insert: {
          action_after: string
          email?: string | null
          id?: string
          reason?: string | null
          requested_at?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject_kind: string
          user_id: string
        }
        Update: {
          action_after?: string
          email?: string | null
          id?: string
          reason?: string | null
          requested_at?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject_kind?: string
          user_id?: string
        }
        Relationships: []
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
          grading_scale_version_id: string | null
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
          unlock_reason: string | null
          unlocked_at: string | null
          unlocked_by: string | null
          updated_at: string
          was_published: boolean
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
          grading_scale_version_id?: string | null
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
          unlock_reason?: string | null
          unlocked_at?: string | null
          unlocked_by?: string | null
          updated_at?: string
          was_published?: boolean
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
          grading_scale_version_id?: string | null
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
          unlock_reason?: string | null
          unlocked_at?: string | null
          unlocked_by?: string | null
          updated_at?: string
          was_published?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "exam_results_grading_scale_version_id_fkey"
            columns: ["grading_scale_version_id"]
            isOneToOne: false
            referencedRelation: "school_grading_scale_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_results_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "exam_results_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
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
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "fee_record_revisions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
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
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "fee_records_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
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
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "fee_structures_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "fee_structures_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_documents: {
        Row: {
          academic_year: string | null
          byte_size: number | null
          created_at: string
          doc_type: string
          failure_reason: string | null
          generated_by: string | null
          id: string
          payment_id: string | null
          school_id: string
          status: string
          storage_path: string | null
          student_id: string | null
          term_number: number | null
          updated_at: string
        }
        Insert: {
          academic_year?: string | null
          byte_size?: number | null
          created_at?: string
          doc_type: string
          failure_reason?: string | null
          generated_by?: string | null
          id?: string
          payment_id?: string | null
          school_id: string
          status?: string
          storage_path?: string | null
          student_id?: string | null
          term_number?: number | null
          updated_at?: string
        }
        Update: {
          academic_year?: string | null
          byte_size?: number | null
          created_at?: string
          doc_type?: string
          failure_reason?: string | null
          generated_by?: string | null
          id?: string
          payment_id?: string | null
          school_id?: string
          status?: string
          storage_path?: string | null
          student_id?: string | null
          term_number?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_documents_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "generated_documents_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "generated_documents_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      job_runs: {
        Row: {
          attempts: number
          created_at: string
          finished_at: string | null
          id: string
          job_type: string
          last_error: string | null
          queue_job_id: string | null
          queued_at: string
          reference_id: string | null
          reference_type: string | null
          school_id: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          job_type: string
          last_error?: string | null
          queue_job_id?: string | null
          queued_at?: string
          reference_id?: string | null
          reference_type?: string | null
          school_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          job_type?: string
          last_error?: string | null
          queue_job_id?: string | null
          queued_at?: string
          reference_id?: string | null
          reference_type?: string | null
          school_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_runs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "job_runs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "job_runs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      message_log: {
        Row: {
          channel: string
          consumed_quota: boolean
          created_at: string
          delivered_at: string | null
          failed_at: string | null
          failure_reason: string | null
          fallback_of_id: string | null
          id: string
          is_fallback: boolean
          message_body: string | null
          provider_message_id: string | null
          read_at: string | null
          recipient_email: string | null
          recipient_phone: string | null
          recipient_user_id: string | null
          retry_count: number
          school_id: string | null
          sent_at: string | null
          status: string
          student_id: string | null
          template_key: string
          variables: Json | null
        }
        Insert: {
          channel: string
          consumed_quota?: boolean
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          fallback_of_id?: string | null
          id?: string
          is_fallback?: boolean
          message_body?: string | null
          provider_message_id?: string | null
          read_at?: string | null
          recipient_email?: string | null
          recipient_phone?: string | null
          recipient_user_id?: string | null
          retry_count?: number
          school_id?: string | null
          sent_at?: string | null
          status?: string
          student_id?: string | null
          template_key: string
          variables?: Json | null
        }
        Update: {
          channel?: string
          consumed_quota?: boolean
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          fallback_of_id?: string | null
          id?: string
          is_fallback?: boolean
          message_body?: string | null
          provider_message_id?: string | null
          read_at?: string | null
          recipient_email?: string | null
          recipient_phone?: string | null
          recipient_user_id?: string | null
          retry_count?: number
          school_id?: string | null
          sent_at?: string | null
          status?: string
          student_id?: string | null
          template_key?: string
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "message_log_fallback_of_id_fkey"
            columns: ["fallback_of_id"]
            isOneToOne: false
            referencedRelation: "message_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_log_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "message_log_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "message_log_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_log_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          body: string
          channel: string
          created_at: string
          id: string
          is_active: boolean
          language_code: string
          meta_template_name: string | null
          school_id: string | null
          subject: string | null
          template_key: string
          updated_at: string
          updated_by: string | null
          variables: string[]
        }
        Insert: {
          body: string
          channel: string
          created_at?: string
          id?: string
          is_active?: boolean
          language_code?: string
          meta_template_name?: string | null
          school_id?: string | null
          subject?: string | null
          template_key: string
          updated_at?: string
          updated_by?: string | null
          variables?: string[]
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          id?: string
          is_active?: boolean
          language_code?: string
          meta_template_name?: string | null
          school_id?: string | null
          subject?: string | null
          template_key?: string
          updated_at?: string
          updated_by?: string | null
          variables?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "notification_templates_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "notification_templates_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "notification_templates_school_id_fkey"
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
          overridden: boolean
          overridden_at: string | null
          overridden_by: string | null
          overridden_by_role: string | null
          override_reason: string | null
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
          overridden?: boolean
          overridden_at?: string | null
          overridden_by?: string | null
          overridden_by_role?: string | null
          override_reason?: string | null
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
          overridden?: boolean
          overridden_at?: string | null
          overridden_by?: string | null
          overridden_by_role?: string | null
          override_reason?: string | null
          school_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_checklists_item_key_fkey"
            columns: ["item_key"]
            isOneToOne: false
            referencedRelation: "onboarding_checklist_catalogue"
            referencedColumns: ["item_key"]
          },
          {
            foreignKeyName: "onboarding_checklists_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "onboarding_checklists_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "onboarding_checklists_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_link_claims: {
        Row: {
          claimant_email: string | null
          claimant_user_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          matched_on: string
          parent_id: string
          requested_at: string
          school_id: string
          status: string
        }
        Insert: {
          claimant_email?: string | null
          claimant_user_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          matched_on: string
          parent_id: string
          requested_at?: string
          school_id: string
          status?: string
        }
        Update: {
          claimant_email?: string | null
          claimant_user_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          matched_on?: string
          parent_id?: string
          requested_at?: string
          school_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "parent_link_claims_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "parents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_link_claims_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "parent_link_claims_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "parent_link_claims_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_push_tokens: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          last_seen_at: string
          parent_user_id: string
          platform: string
          push_token: string
          retired_at: string | null
          retired_reason: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string
          parent_user_id: string
          platform: string
          push_token: string
          retired_at?: string | null
          retired_reason?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string
          parent_user_id?: string
          platform?: string
          push_token?: string
          retired_at?: string | null
          retired_reason?: string | null
          updated_at?: string
        }
        Relationships: []
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
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "payment_gateways_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
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
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "payments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
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
      platform_incidents: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          dedupe_key: string
          detail: string | null
          feature_key: string | null
          first_seen_at: string
          id: string
          is_school_visible: boolean
          kind: string
          last_seen_at: string
          metadata: Json
          occurrence_count: number
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          school_id: string | null
          severity: string
          source: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          dedupe_key: string
          detail?: string | null
          feature_key?: string | null
          first_seen_at?: string
          id?: string
          is_school_visible?: boolean
          kind: string
          last_seen_at?: string
          metadata?: Json
          occurrence_count?: number
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          school_id?: string | null
          severity?: string
          source: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          dedupe_key?: string
          detail?: string | null
          feature_key?: string | null
          first_seen_at?: string
          id?: string
          is_school_visible?: boolean
          kind?: string
          last_seen_at?: string
          metadata?: Json
          occurrence_count?: number
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          school_id?: string | null
          severity?: string
          source?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_incidents_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "feature_catalogue"
            referencedColumns: ["feature_key"]
          },
          {
            foreignKeyName: "platform_incidents_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "platform_incidents_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "platform_incidents_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
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
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "report_generation_jobs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
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
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_academic_config_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_academic_config_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_branding: {
        Row: {
          anchor_color: string | null
          created_at: string
          icon_url: string | null
          logo_url: string | null
          primary_color: string | null
          school_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          anchor_color?: string | null
          created_at?: string
          icon_url?: string | null
          logo_url?: string | null
          primary_color?: string | null
          school_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          anchor_color?: string | null
          created_at?: string
          icon_url?: string | null
          logo_url?: string | null
          primary_color?: string | null
          school_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "school_branding_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_branding_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_branding_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_credit_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string
          clerk_user_id: string
          credits_allocated: number
          id: string
          period_end: string
          period_start: string
          purchase_id: string
          revoked_at: string | null
          revoked_by: string | null
          school_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          clerk_user_id: string
          credits_allocated: number
          id?: string
          period_end: string
          period_start: string
          purchase_id: string
          revoked_at?: string | null
          revoked_by?: string | null
          school_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          clerk_user_id?: string
          credits_allocated?: number
          id?: string
          period_end?: string
          period_start?: string
          purchase_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_credit_assignments_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "school_credit_purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_credit_assignments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_credit_assignments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_credit_assignments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_credit_purchases: {
        Row: {
          account_id: string
          created_at: string
          created_by: string
          credits_per_seat: number
          currency_code: string
          id: string
          invoice_id: string | null
          lot_id: string | null
          period_end: string
          period_kind: string
          period_start: string
          plan_code: string
          price_per_seat: number
          school_id: string
          seats: number
          total_amount: number
          total_credits: number
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by: string
          credits_per_seat: number
          currency_code?: string
          id?: string
          invoice_id?: string | null
          lot_id?: string | null
          period_end: string
          period_kind: string
          period_start: string
          plan_code: string
          price_per_seat: number
          school_id: string
          seats: number
          total_amount: number
          total_credits: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string
          credits_per_seat?: number
          currency_code?: string
          id?: string
          invoice_id?: string | null
          lot_id?: string | null
          period_end?: string
          period_kind?: string
          period_start?: string
          plan_code?: string
          price_per_seat?: number
          school_id?: string
          seats?: number
          total_amount?: number
          total_credits?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_credit_purchases_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ai_credit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_credit_purchases_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_credit_purchases_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "ai_credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_credit_purchases_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_credit_purchases_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_credit_purchases_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_credit_settings: {
        Row: {
          reserve_enabled: boolean
          reserve_per_teacher_cap: number | null
          school_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          reserve_enabled?: boolean
          reserve_per_teacher_cap?: number | null
          school_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          reserve_enabled?: boolean
          reserve_per_teacher_cap?: number | null
          school_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "school_credit_settings_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_credit_settings_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_credit_settings_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_custom_fields: {
        Row: {
          created_at: string
          display_order: number
          entity_type: string
          field_key: string
          field_type: string
          help_text: string | null
          id: string
          is_active: boolean
          is_required: boolean
          label: string
          options: Json
          school_id: string
          sensitivity: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          entity_type?: string
          field_key: string
          field_type: string
          help_text?: string | null
          id?: string
          is_active?: boolean
          is_required?: boolean
          label: string
          options?: Json
          school_id: string
          sensitivity?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          entity_type?: string
          field_key?: string
          field_type?: string
          help_text?: string | null
          id?: string
          is_active?: boolean
          is_required?: boolean
          label?: string
          options?: Json
          school_id?: string
          sensitivity?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_custom_fields_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_custom_fields_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_custom_fields_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
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
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_grade_levels_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_grade_levels_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_grading_scale_versions: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          credit_mark: number | null
          effective_from: string
          grade_bands: Json
          grading_scale_id: string
          id: string
          pass_mark: number | null
          revision_reason: string | null
          school_id: string
          superseded_at: string | null
          version_number: number
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          credit_mark?: number | null
          effective_from?: string
          grade_bands: Json
          grading_scale_id: string
          id?: string
          pass_mark?: number | null
          revision_reason?: string | null
          school_id: string
          superseded_at?: string | null
          version_number: number
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          credit_mark?: number | null
          effective_from?: string
          grade_bands?: Json
          grading_scale_id?: string
          id?: string
          pass_mark?: number | null
          revision_reason?: string | null
          school_id?: string
          superseded_at?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "school_grading_scale_versions_grading_scale_id_fkey"
            columns: ["grading_scale_id"]
            isOneToOne: false
            referencedRelation: "school_grading_scales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_grading_scale_versions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_grading_scale_versions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_grading_scale_versions_school_id_fkey"
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
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_grading_scales_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_grading_scales_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_join_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          granted_role: string | null
          id: string
          note: string | null
          requested_at: string
          requester_email: string
          requester_name: string
          requester_user_id: string
          school_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          granted_role?: string | null
          id?: string
          note?: string | null
          requested_at?: string
          requester_email: string
          requester_name: string
          requester_user_id: string
          school_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          granted_role?: string | null
          id?: string
          note?: string | null
          requested_at?: string
          requester_email?: string
          requester_name?: string
          requester_user_id?: string
          school_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_join_requests_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_join_requests_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_join_requests_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_message_quotas: {
        Row: {
          alert_80_sent_at: string | null
          billing_period: string
          created_at: string
          id: string
          last_updated_at: string
          messages_used: number
          overage_credits: number
          quota_limit: number | null
          school_id: string
        }
        Insert: {
          alert_80_sent_at?: string | null
          billing_period: string
          created_at?: string
          id?: string
          last_updated_at?: string
          messages_used?: number
          overage_credits?: number
          quota_limit?: number | null
          school_id: string
        }
        Update: {
          alert_80_sent_at?: string | null
          billing_period?: string
          created_at?: string
          id?: string
          last_updated_at?: string
          messages_used?: number
          overage_credits?: number
          quota_limit?: number | null
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_message_quotas_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_message_quotas_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_message_quotas_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_network_members: {
        Row: {
          added_by: string | null
          clerk_user_id: string
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          network_id: string
          network_role: string
          updated_at: string
        }
        Insert: {
          added_by?: string | null
          clerk_user_id: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          network_id: string
          network_role: string
          updated_at?: string
        }
        Update: {
          added_by?: string | null
          clerk_user_id?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          network_id?: string
          network_role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_network_members_network_id_fkey"
            columns: ["network_id"]
            isOneToOne: false
            referencedRelation: "school_networks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_network_members_network_role_fkey"
            columns: ["network_role"]
            isOneToOne: false
            referencedRelation: "school_network_roles"
            referencedColumns: ["role_key"]
          },
        ]
      }
      school_network_roles: {
        Row: {
          can_attach_schools: boolean
          can_manage_members: boolean
          can_view_financial: boolean
          can_view_network: boolean
          created_at: string
          description: string | null
          display_order: number
          label: string
          role_key: string
        }
        Insert: {
          can_attach_schools?: boolean
          can_manage_members?: boolean
          can_view_financial?: boolean
          can_view_network?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          label: string
          role_key: string
        }
        Update: {
          can_attach_schools?: boolean
          can_manage_members?: boolean
          can_view_financial?: boolean
          can_view_network?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          label?: string
          role_key?: string
        }
        Relationships: []
      }
      school_network_schools: {
        Row: {
          attached_at: string
          attached_by: string | null
          created_at: string
          detached_at: string | null
          id: string
          is_active: boolean
          network_id: string
          owner_access_granted_at: string | null
          owner_access_granted_by: string | null
          owner_access_invited_email: string | null
          school_id: string
        }
        Insert: {
          attached_at?: string
          attached_by?: string | null
          created_at?: string
          detached_at?: string | null
          id?: string
          is_active?: boolean
          network_id: string
          owner_access_granted_at?: string | null
          owner_access_granted_by?: string | null
          owner_access_invited_email?: string | null
          school_id: string
        }
        Update: {
          attached_at?: string
          attached_by?: string | null
          created_at?: string
          detached_at?: string | null
          id?: string
          is_active?: boolean
          network_id?: string
          owner_access_granted_at?: string | null
          owner_access_granted_by?: string | null
          owner_access_invited_email?: string | null
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_network_schools_network_id_fkey"
            columns: ["network_id"]
            isOneToOne: false
            referencedRelation: "school_networks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_network_schools_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_network_schools_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_network_schools_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_networks: {
        Row: {
          billing_mode: string
          created_at: string
          data_scope: string
          id: string
          name: string
          notes: string | null
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          billing_mode?: string
          created_at?: string
          data_scope?: string
          id?: string
          name: string
          notes?: string | null
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          billing_mode?: string
          created_at?: string
          data_scope?: string
          id?: string
          name?: string
          notes?: string | null
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      school_onboarding: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          assigned_at: string | null
          assigned_to: string | null
          created_at: string
          created_by: string | null
          internal_notes: string | null
          owner_accepted_at: string | null
          owner_email: string
          owner_first_name: string
          owner_invitation_id: string | null
          owner_invited_at: string | null
          owner_last_name: string
          owner_phone_e164: string | null
          privacy_accepted_at: string | null
          referral_source: string | null
          school_id: string
          source: string
          task_status: string
          terms_accepted_at: string | null
          updated_at: string
          verification_note: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          assigned_at?: string | null
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          internal_notes?: string | null
          owner_accepted_at?: string | null
          owner_email: string
          owner_first_name: string
          owner_invitation_id?: string | null
          owner_invited_at?: string | null
          owner_last_name: string
          owner_phone_e164?: string | null
          privacy_accepted_at?: string | null
          referral_source?: string | null
          school_id: string
          source: string
          task_status?: string
          terms_accepted_at?: string | null
          updated_at?: string
          verification_note?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          assigned_at?: string | null
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          internal_notes?: string | null
          owner_accepted_at?: string | null
          owner_email?: string
          owner_first_name?: string
          owner_invitation_id?: string | null
          owner_invited_at?: string | null
          owner_last_name?: string
          owner_phone_e164?: string | null
          privacy_accepted_at?: string | null
          referral_source?: string | null
          school_id?: string
          source?: string
          task_status?: string
          terms_accepted_at?: string | null
          updated_at?: string
          verification_note?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "school_onboarding_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_onboarding_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_onboarding_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_onboarding_contacts: {
        Row: {
          channel: string
          contacted_at: string
          contacted_by: string
          created_at: string
          follow_up_at: string | null
          id: string
          note: string | null
          outcome: string
          school_id: string
        }
        Insert: {
          channel?: string
          contacted_at?: string
          contacted_by: string
          created_at?: string
          follow_up_at?: string | null
          id?: string
          note?: string | null
          outcome: string
          school_id: string
        }
        Update: {
          channel?: string
          contacted_at?: string
          contacted_by?: string
          created_at?: string
          follow_up_at?: string | null
          id?: string
          note?: string | null
          outcome?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_onboarding_contacts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_onboarding_contacts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_onboarding_contacts_school_id_fkey"
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
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_permissions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_permissions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_public_profiles: {
        Row: {
          about: string | null
          created_at: string
          established_year: number | null
          fee_band_max: number | null
          fee_band_min: number | null
          has_boarding: boolean
          has_computer_lab: boolean
          has_feeding: boolean
          has_library: boolean
          has_science_lab: boolean
          has_special_needs: boolean
          has_sports: boolean
          has_transport: boolean
          is_published: boolean
          publish_class_sizes: boolean
          publish_fee_band: boolean
          publish_ratio: boolean
          school_id: string
          updated_at: string
          updated_by: string | null
          website_url: string | null
        }
        Insert: {
          about?: string | null
          created_at?: string
          established_year?: number | null
          fee_band_max?: number | null
          fee_band_min?: number | null
          has_boarding?: boolean
          has_computer_lab?: boolean
          has_feeding?: boolean
          has_library?: boolean
          has_science_lab?: boolean
          has_special_needs?: boolean
          has_sports?: boolean
          has_transport?: boolean
          is_published?: boolean
          publish_class_sizes?: boolean
          publish_fee_band?: boolean
          publish_ratio?: boolean
          school_id: string
          updated_at?: string
          updated_by?: string | null
          website_url?: string | null
        }
        Update: {
          about?: string | null
          created_at?: string
          established_year?: number | null
          fee_band_max?: number | null
          fee_band_min?: number | null
          has_boarding?: boolean
          has_computer_lab?: boolean
          has_feeding?: boolean
          has_library?: boolean
          has_science_lab?: boolean
          has_special_needs?: boolean
          has_sports?: boolean
          has_transport?: boolean
          is_published?: boolean
          publish_class_sizes?: boolean
          publish_fee_band?: boolean
          publish_ratio?: boolean
          school_id?: string
          updated_at?: string
          updated_by?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "school_public_profiles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_public_profiles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_public_profiles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
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
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_subjects_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
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
      school_term_dates: {
        Row: {
          academic_year: string
          created_at: string
          ends_on: string
          id: string
          school_id: string
          starts_on: string
          term_number: number
          updated_at: string
        }
        Insert: {
          academic_year: string
          created_at?: string
          ends_on: string
          id?: string
          school_id: string
          starts_on: string
          term_number: number
          updated_at?: string
        }
        Update: {
          academic_year?: string
          created_at?: string
          ends_on?: string
          id?: string
          school_id?: string
          starts_on?: string
          term_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_term_dates_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_term_dates_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "school_term_dates_school_id_fkey"
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
          display_name: string | null
          email: string | null
          finance_module_enabled: boolean
          id: string
          level: string
          logo_url: string | null
          max_students: number | null
          ministry_reg_number: string | null
          name: string
          phone: string | null
          province_code: string
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
          display_name?: string | null
          email?: string | null
          finance_module_enabled?: boolean
          id?: string
          level: string
          logo_url?: string | null
          max_students?: number | null
          ministry_reg_number?: string | null
          name: string
          phone?: string | null
          province_code: string
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
          display_name?: string | null
          email?: string | null
          finance_module_enabled?: boolean
          id?: string
          level?: string
          logo_url?: string | null
          max_students?: number | null
          ministry_reg_number?: string | null
          name?: string
          phone?: string | null
          province_code?: string
          school_id?: string
          status?: string
          subscription_ends_at?: string | null
          subscription_tier?: string
          trial_ends_at?: string | null
          type?: string
          updated_at?: string
          whatsapp_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "fk_schools_subscription_tier"
            columns: ["subscription_tier"]
            isOneToOne: false
            referencedRelation: "subscription_tier_catalogue"
            referencedColumns: ["tier_name"]
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
          location: string | null
          phone_e164: string | null
          photo_url: string | null
          qualifications: string | null
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
          location?: string | null
          phone_e164?: string | null
          photo_url?: string | null
          qualifications?: string | null
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
          location?: string | null
          phone_e164?: string | null
          photo_url?: string | null
          qualifications?: string | null
          school_id?: string
          staff_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_members_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "staff_members_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
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
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "staff_permission_grants_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
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
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "staff_requests_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "staff_requests_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      standalone_teacher_accounts: {
        Row: {
          clerk_user_id: string
          country_code: string
          created_at: string
          curriculum_types: string[]
          email: string
          full_name: string
          grade_levels: string[]
          id: string
          phone_e164: string | null
          plan_code: string
          resources_created: number
          subjects: string[]
          subscription_ends_at: string | null
          subscription_started_at: string | null
          subscription_status: string
          trial_allowance_override: number | null
          trial_resources_used: number
          updated_at: string
        }
        Insert: {
          clerk_user_id: string
          country_code?: string
          created_at?: string
          curriculum_types?: string[]
          email: string
          full_name: string
          grade_levels?: string[]
          id?: string
          phone_e164?: string | null
          plan_code?: string
          resources_created?: number
          subjects?: string[]
          subscription_ends_at?: string | null
          subscription_started_at?: string | null
          subscription_status?: string
          trial_allowance_override?: number | null
          trial_resources_used?: number
          updated_at?: string
        }
        Update: {
          clerk_user_id?: string
          country_code?: string
          created_at?: string
          curriculum_types?: string[]
          email?: string
          full_name?: string
          grade_levels?: string[]
          id?: string
          phone_e164?: string | null
          plan_code?: string
          resources_created?: number
          subjects?: string[]
          subscription_ends_at?: string | null
          subscription_started_at?: string | null
          subscription_status?: string
          trial_allowance_override?: number | null
          trial_resources_used?: number
          updated_at?: string
        }
        Relationships: []
      }
      student_custom_values: {
        Row: {
          created_at: string
          field_id: string
          id: string
          school_id: string
          student_id: string
          updated_at: string
          value_boolean: boolean | null
          value_date: string | null
          value_json: Json | null
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          created_at?: string
          field_id: string
          id?: string
          school_id: string
          student_id: string
          updated_at?: string
          value_boolean?: boolean | null
          value_date?: string | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          created_at?: string
          field_id?: string
          id?: string
          school_id?: string
          student_id?: string
          updated_at?: string
          value_boolean?: boolean | null
          value_date?: string | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_custom_values_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "school_custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_custom_values_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "student_custom_values_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "student_custom_values_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_custom_values_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
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
          examination_number: string | null
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
          examination_number?: string | null
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
          examination_number?: string | null
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
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "students_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
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
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "teacher_assignments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
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
      teaching_resources: {
        Row: {
          content: Json
          created_at: string
          created_by: string
          curriculum_type: string
          duration_minutes: number | null
          generation_params: Json
          generator_name: string
          generator_version: string
          grade_level: string
          id: string
          is_deleted: boolean
          is_shared: boolean
          knowledge_sources: Json | null
          lesson_type: string | null
          prompt_template_version: number | null
          resource_kind: string
          school_id: string | null
          subject: string
          teacher_notes: string | null
          title: string
          topic: string
          updated_at: string
        }
        Insert: {
          content: Json
          created_at?: string
          created_by: string
          curriculum_type: string
          duration_minutes?: number | null
          generation_params?: Json
          generator_name: string
          generator_version: string
          grade_level: string
          id?: string
          is_deleted?: boolean
          is_shared?: boolean
          knowledge_sources?: Json | null
          lesson_type?: string | null
          prompt_template_version?: number | null
          resource_kind: string
          school_id?: string | null
          subject: string
          teacher_notes?: string | null
          title: string
          topic: string
          updated_at?: string
        }
        Update: {
          content?: Json
          created_at?: string
          created_by?: string
          curriculum_type?: string
          duration_minutes?: number | null
          generation_params?: Json
          generator_name?: string
          generator_version?: string
          grade_level?: string
          id?: string
          is_deleted?: boolean
          is_shared?: boolean
          knowledge_sources?: Json | null
          lesson_type?: string | null
          prompt_template_version?: number | null
          resource_kind?: string
          school_id?: string | null
          subject?: string
          teacher_notes?: string | null
          title?: string
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teaching_resources_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "teaching_resources_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "teaching_resources_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      feature_catalogue: {
        Row: {
          category: string | null
          description: string | null
          display_name: string | null
          display_order: number | null
          feature_key: string | null
          is_active: boolean | null
          is_available_as_addon: boolean | null
          monthly_addon_price_usd: number | null
          monthly_addon_price_zmw: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          category?: string | null
          description?: string | null
          display_name?: string | null
          display_order?: number | null
          feature_key?: string | null
          is_active?: boolean | null
          is_available_as_addon?: boolean | null
          monthly_addon_price_usd?: number | null
          monthly_addon_price_zmw?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          category?: string | null
          description?: string | null
          display_name?: string | null
          display_order?: number | null
          feature_key?: string | null
          is_active?: boolean | null
          is_available_as_addon?: boolean | null
          monthly_addon_price_usd?: number | null
          monthly_addon_price_zmw?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
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
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "fee_records_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
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
      invoice_lines: {
        Row: {
          amount: number | null
          description: string | null
          display_order: number | null
          feature_key: string | null
          id: string | null
          invoice_id: string | null
          line_type: string | null
          quantity: number | null
          unit_price: number | null
        }
        Insert: {
          amount?: number | null
          description?: string | null
          display_order?: number | null
          feature_key?: string | null
          id?: string | null
          invoice_id?: string | null
          line_type?: string | null
          quantity?: number | null
          unit_price?: number | null
        }
        Update: {
          amount?: number | null
          description?: string | null
          display_order?: number | null
          feature_key?: string | null
          id?: string | null
          invoice_id?: string | null
          line_type?: string | null
          quantity?: number | null
          unit_price?: number | null
        }
        Relationships: []
      }
      invoice_payments: {
        Row: {
          amount: number | null
          created_at: string | null
          currency: string | null
          gateway_name: string | null
          gateway_reference: string | null
          id: string | null
          invoice_id: string | null
          method: string | null
          notes: string | null
          received_at: string | null
          recorded_by: string | null
          reference: string | null
          status: string | null
          webhook_verified: boolean | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          currency?: string | null
          gateway_name?: string | null
          gateway_reference?: string | null
          id?: string | null
          invoice_id?: string | null
          method?: string | null
          notes?: string | null
          received_at?: string | null
          recorded_by?: string | null
          reference?: string | null
          status?: string | null
          webhook_verified?: boolean | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          currency?: string | null
          gateway_name?: string | null
          gateway_reference?: string | null
          id?: string | null
          invoice_id?: string | null
          method?: string | null
          notes?: string | null
          received_at?: string | null
          recorded_by?: string | null
          reference?: string | null
          status?: string | null
          webhook_verified?: boolean | null
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount_paid: number | null
          created_at: string | null
          currency: string | null
          due_at: string | null
          id: string | null
          invoice_number: string | null
          issued_at: string | null
          notes: string | null
          paid_at: string | null
          period_end: string | null
          period_start: string | null
          pricing_model: string | null
          school_code: string | null
          school_id: string | null
          school_name: string | null
          status: string | null
          student_count: number | null
          subtotal: number | null
          tax_amount: number | null
          tax_rate: number | null
          tier_name: string | null
          total: number | null
          unit_price: number | null
          void_reason: string | null
          voided_at: string | null
        }
        Relationships: []
      }
      onboarding_checklist_catalogue: {
        Row: {
          blocks: string | null
          category: string | null
          description: string | null
          is_active: boolean | null
          item_key: string | null
          label: string | null
          sort_order: number | null
          weight: number | null
        }
        Insert: {
          blocks?: string | null
          category?: string | null
          description?: string | null
          is_active?: boolean | null
          item_key?: string | null
          label?: string | null
          sort_order?: number | null
          weight?: number | null
        }
        Update: {
          blocks?: string | null
          category?: string | null
          description?: string | null
          is_active?: boolean | null
          item_key?: string | null
          label?: string | null
          sort_order?: number | null
          weight?: number | null
        }
        Relationships: []
      }
      onboarding_queue: {
        Row: {
          assigned_to: string | null
          city_code: string | null
          completion_pct: number | null
          contact_attempts: number | null
          converted: boolean | null
          critical_pct: number | null
          first_contact_at: string | null
          hours_to_contact: number | null
          lapsed: boolean | null
          last_contact_at: string | null
          next_follow_up_at: string | null
          outreach_escalated: boolean | null
          outreach_overdue: boolean | null
          owner_accepted_at: string | null
          owner_email: string | null
          owner_first_name: string | null
          owner_last_name: string | null
          owner_phone_e164: string | null
          province_code: string | null
          registered_at: string | null
          school_code: string | null
          school_id: string | null
          school_name: string | null
          school_status: string | null
          source: string | null
          subscription_tier: string | null
          task_status: string | null
          trial_days_left: number | null
          trial_ends_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_schools_subscription_tier"
            columns: ["subscription_tier"]
            isOneToOne: false
            referencedRelation: "subscription_tier_catalogue"
            referencedColumns: ["tier_name"]
          },
        ]
      }
      school_capacity: {
        Row: {
          at_capacity: boolean | null
          current_count: number | null
          is_unlimited: boolean | null
          remaining: number | null
          school_id: string | null
          source: string | null
          student_limit: number | null
        }
        Relationships: []
      }
      school_feature_exceptions: {
        Row: {
          created_at: string | null
          expires_at: string | null
          feature_key: string | null
          granted_by: string | null
          id: string | null
          is_active: boolean | null
          override_type: string | null
          override_value: string | null
          reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          school_id: string | null
          ticket_ref: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          feature_key?: string | null
          granted_by?: string | null
          id?: string | null
          is_active?: boolean | null
          override_type?: string | null
          override_value?: string | null
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          school_id?: string | null
          ticket_ref?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          feature_key?: string | null
          granted_by?: string | null
          id?: string | null
          is_active?: boolean | null
          override_type?: string | null
          override_value?: string | null
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          school_id?: string | null
          ticket_ref?: string | null
        }
        Relationships: []
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
            referencedRelation: "onboarding_queue"
            referencedColumns: ["school_id"]
          },
          {
            foreignKeyName: "fee_records_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_capacity"
            referencedColumns: ["school_id"]
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
      subscription_tier_catalogue: {
        Row: {
          annual_price_usd: number | null
          annual_price_zmw: number | null
          display_name: string | null
          display_order: number | null
          is_publicly_listed: boolean | null
          monthly_price_usd: number | null
          monthly_price_zmw: number | null
          price_bands: Json | null
          pricing_model: string | null
          student_limit: number | null
          tier_name: string | null
          whatsapp_quota: number | null
        }
        Insert: {
          annual_price_usd?: number | null
          annual_price_zmw?: number | null
          display_name?: string | null
          display_order?: number | null
          is_publicly_listed?: boolean | null
          monthly_price_usd?: number | null
          monthly_price_zmw?: number | null
          price_bands?: never
          pricing_model?: string | null
          student_limit?: number | null
          tier_name?: string | null
          whatsapp_quota?: number | null
        }
        Update: {
          annual_price_usd?: number | null
          annual_price_zmw?: number | null
          display_name?: string | null
          display_order?: number | null
          is_publicly_listed?: boolean | null
          monthly_price_usd?: number | null
          monthly_price_zmw?: number | null
          price_bands?: never
          pricing_model?: string | null
          student_limit?: number | null
          tier_name?: string | null
          whatsapp_quota?: number | null
        }
        Relationships: []
      }
      tier_feature_matrix: {
        Row: {
          feature_key: string | null
          is_included: boolean | null
          tier_name: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          feature_key?: string | null
          is_included?: boolean | null
          tier_name?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          feature_key?: string | null
          is_included?: boolean | null
          tier_name?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      tier_price_bands: {
        Row: {
          created_at: string | null
          id: string | null
          max_students: number | null
          min_students: number | null
          price_per_student_usd: number | null
          price_per_student_zmw: number | null
          tier_name: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          max_students?: number | null
          min_students?: number | null
          price_per_student_usd?: number | null
          price_per_student_zmw?: number | null
          tier_name?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          max_students?: number | null
          min_students?: number | null
          price_per_student_usd?: number | null
          price_per_student_zmw?: number | null
          tier_name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      academic_year_is_current: {
        Args: { p_academic_year: string }
        Returns: boolean
      }
      academic_years_match: {
        Args: { p_left: string; p_right: string }
        Returns: boolean
      }
      admin_abandon_unprovisioned_school: {
        Args: { p_reason?: string; p_school_id: string }
        Returns: {
          out_id: string
          out_school_id: string
          out_status: string
        }[]
      }
      admin_activate_school: {
        Args: { p_school_id: string; p_verification_note: string }
        Returns: {
          id: string
          name: string
          school_id: string
          status: string
        }[]
      }
      admin_ai_usage_breakdown: {
        Args: { p_dimension?: string; p_school_id?: string }
        Returns: {
          out_actions: number
          out_cost_usd: number
          out_credits_spent: number
          out_label: string
          out_schools: number
        }[]
      }
      admin_ai_usage_distribution: {
        Args: { p_school_id?: string }
        Returns: {
          out_band: string
          out_credits: number
          out_teachers: number
        }[]
      }
      admin_anonymise_data_subject: {
        Args: { p_id: string; p_kind: string; p_reason: string }
        Returns: {
          out_done: boolean
          out_message: string
          out_retained: string
        }[]
      }
      admin_attach_clerk_org: {
        Args: { p_clerk_org_id: string; p_school_id: string }
        Returns: boolean
      }
      admin_create_override: {
        Args: {
          p_actor: string
          p_expires_at: string
          p_feature_key: string
          p_override_type: string
          p_override_value: string
          p_reason: string
          p_school_id: string
          p_ticket_ref: string
        }
        Returns: string
      }
      admin_create_school: {
        Args: {
          p_address?: string
          p_city_code: string
          p_country_code?: string
          p_internal_notes?: string
          p_level: string
          p_ministry_reg_number?: string
          p_name: string
          p_owner_email: string
          p_owner_first_name: string
          p_owner_last_name: string
          p_owner_phone_e164?: string
          p_province_code: string
          p_subscription_tier?: string
          p_type: string
        }
        Returns: {
          city_code: string
          clerk_slug: string
          id: string
          name: string
          province_code: string
          school_id: string
          status: string
        }[]
      }
      admin_delete_tier_price_band: {
        Args: { p_band_id: string }
        Returns: boolean
      }
      admin_export_data_subject: {
        Args: { p_id: string; p_kind: string }
        Returns: Json
      }
      admin_generate_school_invoice: {
        Args: {
          p_currency?: string
          p_due_days?: number
          p_period_end: string
          p_period_start: string
          p_school_id: string
          p_tax_rate?: number
        }
        Returns: Json
      }
      admin_issue_invoice: { Args: { p_invoice_id: string }; Returns: Json }
      admin_network_suggestions: {
        Args: never
        Returns: {
          out_already_networked: number
          out_basis: string
          out_identifier: string
          out_owner_name: string
          out_school_count: number
          out_school_ids: string[]
          out_school_names: string[]
        }[]
      }
      admin_publish_prompt_template: {
        Args: {
          p_change_note?: string
          p_feature_key: string
          p_model_params?: Json
          p_system_prompt: string
          p_user_template: string
        }
        Returns: number
      }
      admin_record_invoice_payment: {
        Args: {
          p_amount: number
          p_invoice_id: string
          p_method: string
          p_notes?: string
          p_received?: string
          p_reference?: string
        }
        Returns: Json
      }
      admin_record_onboarding_contact: {
        Args: {
          p_channel?: string
          p_follow_up_at?: string
          p_note?: string
          p_outcome: string
          p_school_id: string
        }
        Returns: {
          out_contacted_at: string
          out_id: string
          out_task_status: string
        }[]
      }
      admin_record_owner_invitation: {
        Args: { p_invitation_id: string; p_school_id: string }
        Returns: boolean
      }
      admin_revoke_override: {
        Args: { p_actor: string; p_id: string }
        Returns: boolean
      }
      admin_run_billing: {
        Args: {
          p_currency?: string
          p_period_end: string
          p_period_start: string
          p_tax_rate?: number
        }
        Returns: {
          out_created: number
          out_failed: number
          out_problems: Json
          out_skipped: number
        }[]
      }
      admin_school_ai_summary: {
        Args: { p_school_id: string }
        Returns: {
          out_actions: number
          out_cost_usd: number
          out_credits_purchased: number
          out_credits_remaining: number
          out_credits_spent: number
          out_from_reserve: number
          out_last_used_at: string
          out_teachers_active: number
          out_teachers_assigned: number
        }[]
      }
      admin_set_onboarding_task: {
        Args: {
          p_assigned_to?: string
          p_school_id: string
          p_task_status?: string
        }
        Returns: {
          out_assigned_to: string
          out_task_status: string
        }[]
      }
      admin_set_tier_feature: {
        Args: {
          p_actor: string
          p_feature_key: string
          p_included: boolean
          p_tier: string
        }
        Returns: boolean
      }
      admin_set_tier_pricing_model: {
        Args: { p_pricing_model: string; p_tier_name: string }
        Returns: {
          band_count: number
          pricing_model: string
          tier_name: string
        }[]
      }
      admin_teacher_hub_plans: {
        Args: never
        Returns: {
          out_ai_credits_included: number
          out_ai_credits_period: string
          out_billing_period: string
          out_currency_code: string
          out_display_name: string
          out_included_resources: number
          out_is_active: boolean
          out_plan_code: string
          out_price: number
          out_sort_order: number
          out_subscribers: number
        }[]
      }
      admin_update_school_commercial: {
        Args: {
          p_finance_module_enabled?: boolean
          p_school_id: string
          p_status?: string
          p_subscription_ends_at?: string
          p_subscription_tier?: string
          p_trial_ends_at?: string
          p_whatsapp_enabled?: boolean
        }
        Returns: {
          finance_module_enabled: boolean
          id: string
          name: string
          school_id: string
          status: string
          subscription_ends_at: string
          subscription_tier: string
          trial_ends_at: string
          updated_at: string
          whatsapp_enabled: boolean
        }[]
      }
      admin_update_teacher_hub_plan: {
        Args: {
          p_ai_credits_included?: number
          p_display_name?: string
          p_included_resources?: number
          p_is_active?: boolean
          p_plan_code: string
          p_price?: number
          p_sort_order?: number
        }
        Returns: {
          out_plan_code: string
          out_subscribers: number
          out_updated: boolean
        }[]
      }
      admin_update_tier: {
        Args: {
          p_actor?: string
          p_annual_zmw?: number
          p_monthly_usd?: number
          p_monthly_zmw?: number
          p_publicly_listed?: boolean
          p_student_limit?: number
          p_tier_name: string
          p_whatsapp_quota?: number
        }
        Returns: boolean
      }
      admin_upsert_tier_price_band: {
        Args: {
          p_band_id?: string
          p_max_students: number
          p_min_students: number
          p_price_usd: number
          p_price_zmw: number
          p_tier_name: string
        }
        Returns: string
      }
      admin_void_invoice: {
        Args: { p_invoice_id: string; p_reason: string }
        Returns: Json
      }
      ai_allowance_for_account: {
        Args: { p_account_id: string }
        Returns: {
          allowance_credits: number
          allowance_period: string
        }[]
      }
      ai_credit_account_for_caller: { Args: never; Returns: string }
      ai_credit_balance: {
        Args: { p_account_id: string }
        Returns: {
          allowance_credits: number
          allowance_period: string
          allowance_remaining: number
          allowance_used: number
          purchased_available: number
          purchased_expired: number
          purchased_expiring_90d: number
          total_available: number
        }[]
      }
      ai_credit_consume: {
        Args: {
          p_cost_usd?: number
          p_feature_key: string
          p_idempotency_key?: string
          p_input_tokens?: number
          p_metadata?: Json
          p_model_name?: string
          p_output_tokens?: number
          p_source?: string
          p_units?: number
        }
        Returns: {
          credits_charged: number
          funded_allowance: number
          funded_by: string
          funded_purchased: number
        }[]
      }
      ai_credit_topup: {
        Args: {
          p_account_id: string
          p_credits?: number
          p_metadata?: Json
          p_pack_code?: string
          p_reference?: string
        }
        Returns: string
      }
      ai_generation_config: { Args: { p_feature_key: string }; Returns: Json }
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
      announcement_addressed_to_me:
        | {
            Args: {
              p_audience: string
              p_school_id: string
              p_scope: string
              p_target_ids: string[]
            }
            Returns: boolean
          }
        | {
            Args: {
              p_school_id: string
              p_target_ids: string[]
              p_target_type: string
            }
            Returns: boolean
          }
      attach_own_registered_school: {
        Args: { p_clerk_org_id: string; p_school_id: string }
        Returns: boolean
      }
      attach_school_to_network: {
        Args: { p_network_id: string; p_school_id: string }
        Returns: {
          attached_at: string
          attached_by: string | null
          created_at: string
          detached_at: string | null
          id: string
          is_active: boolean
          network_id: string
          owner_access_granted_at: string | null
          owner_access_granted_by: string | null
          owner_access_invited_email: string | null
          school_id: string
        }
        SetofOptions: {
          from: "*"
          to: "school_network_schools"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_parent_links: {
        Args: never
        Returns: {
          out_already_linked: number
          out_email: string
          out_linked: number
        }[]
      }
      clear_student_custom_values: {
        Args: { p_field_ids: string[]; p_student_id: string }
        Returns: number
      }
      complete_generated_document: {
        Args: {
          p_byte_size?: number
          p_document_id: string
          p_error?: string
          p_status: string
          p_storage_path?: string
        }
        Returns: undefined
      }
      complete_job_run: {
        Args: { p_error?: string; p_job_run_id: string; p_status: string }
        Returns: undefined
      }
      consume_message_quota: {
        Args: { p_channel: string; p_count?: number; p_school_id: string }
        Returns: {
          out_allowed: boolean
          out_crossed_80: boolean
          out_messages_used: number
          out_overage_credits: number
          out_quota_limit: number
          out_reason: string
        }[]
      }
      create_teaching_resource: {
        Args: {
          p_content: Json
          p_cost_usd?: number
          p_credit_source?: string
          p_curriculum_type: string
          p_duration_minutes?: number
          p_generation_params?: Json
          p_generator_name: string
          p_generator_version: string
          p_grade_level: string
          p_idempotency_key?: string
          p_input_tokens?: number
          p_knowledge_sources?: Json
          p_lesson_type?: string
          p_model_name?: string
          p_output_tokens?: number
          p_prompt_version?: number
          p_resource_kind: string
          p_school_id?: string
          p_subject: string
          p_title: string
          p_topic: string
        }
        Returns: string
      }
      current_grading_scale_version: {
        Args: { p_scale_id: string }
        Returns: string
      }
      current_school_uuid: { Args: never; Returns: string }
      current_subject_scale_version:
        | {
            Args: { p_school_id: string; p_subject_code: string }
            Returns: string
          }
        | { Args: { p_subject_code: string }; Returns: string }
      current_term: {
        Args: { p_on_date?: string; p_school_id?: string }
        Returns: {
          academic_year: string
          ends_on: string
          is_between: boolean
          starts_on: string
          term_number: number
        }[]
      }
      curriculum_coverage: {
        Args: never
        Returns: {
          country_code: string
          curriculum_type: string
          grade_level: string
          last_updated: string
          outcome_count: number
          sources: string[]
          subject: string
          topic_count: number
        }[]
      }
      curriculum_slice: {
        Args: {
          p_country_code?: string
          p_curriculum_type: string
          p_grade_level: string
          p_subject: string
        }
        Returns: {
          learning_outcomes: string[]
          source: string
          sub_topics: string[]
          suggested_periods: number
          syllabus_year: number
          topic_code: string
          topic_name: string
        }[]
      }
      detach_school_from_network: {
        Args: { p_school_id: string }
        Returns: boolean
      }
      ensure_my_staff_record: {
        Args: {
          p_email?: string
          p_first_name?: string
          p_last_name?: string
          p_phone?: string
        }
        Returns: {
          out_created: boolean
          out_message: string
          out_staff_id: string
        }[]
      }
      ensure_onboarding_checklist: {
        Args: { p_school_id: string }
        Returns: number
      }
      export_my_data: { Args: never; Returns: Json }
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
      get_next_school_sequence: {
        Args: { p_city_code: string; p_country_code: string }
        Returns: number
      }
      get_school_id: { Args: never; Returns: string }
      get_user_email: { Args: never; Returns: string }
      get_user_id: { Args: never; Returns: string }
      get_user_role: { Args: never; Returns: string }
      grade_from_scale_version: {
        Args: {
          p_marks_obtained: number
          p_marks_total: number
          p_version_id: string
        }
        Returns: {
          grade_letter: string
          grade_points: number
        }[]
      }
      has_permission_grant: {
        Args: { p_action: string; p_module: string }
        Returns: boolean
      }
      import_curriculum_topics: {
        Args: { p_rows: Json }
        Returns: {
          errors: Json
          inserted: number
          skipped: number
          updated: number
        }[]
      }
      import_students: {
        Args: { p_rows: Json }
        Returns: {
          created_count: number
        }[]
      }
      is_afritech_admin: { Args: never; Returns: boolean }
      is_impersonation_session: { Args: never; Returns: boolean }
      is_linked_parent_of: { Args: { p_student_id: string }; Returns: boolean }
      is_own_student_record: {
        Args: { p_student_id: string }
        Returns: boolean
      }
      link_parent_to_student: {
        Args: {
          p_email?: string
          p_full_name: string
          p_is_primary?: boolean
          p_phone: string
          p_relationship?: string
          p_student_id: string
        }
        Returns: {
          out_created: boolean
          out_link_id: string
          out_message: string
          out_parent_id: string
        }[]
      }
      log_audit_event: {
        Args: {
          p_action: string
          p_ip_address?: string
          p_metadata?: Json
          p_record_id?: string
          p_school_id?: string
          p_table_name: string
          p_user_agent?: string
        }
        Returns: string
      }
      mask_audit_values: { Args: { p_values: Json }; Returns: Json }
      my_ai_credits: { Args: never; Returns: Json }
      my_children: {
        Args: never
        Returns: {
          out_clerk_org_id: string
          out_first_name: string
          out_last_name: string
          out_school_code: string
          out_school_name: string
          out_school_uuid: string
          out_student_code: string
          out_student_uuid: string
        }[]
      }
      my_erasure_status: {
        Args: never
        Returns: {
          out_action_after: string
          out_blocked_why: string
          out_can_request: boolean
          out_pending: boolean
          out_requested_at: string
          out_retain_years: number
        }[]
      }
      my_network_access: {
        Args: never
        Returns: {
          out_can_attach: boolean
          out_can_manage: boolean
          out_can_see_academic: boolean
          out_can_see_money: boolean
          out_data_scope: string
          out_network_id: string
          out_network_name: string
          out_network_slug: string
          out_role: string
          out_role_label: string
        }[]
      }
      my_network_id: { Args: never; Returns: string }
      my_networks: {
        Args: never
        Returns: {
          out_is_default: boolean
          out_name: string
          out_network_id: string
          out_role: string
          out_role_label: string
          out_schools: number
          out_slug: string
        }[]
      }
      my_onboarding_progress: {
        Args: never
        Returns: {
          out_at: string
          out_blocks: string
          out_by_role: string
          out_category: string
          out_complete: boolean
          out_derived: boolean
          out_description: string
          out_from_data: boolean
          out_item_key: string
          out_label: string
          out_overridden: boolean
          out_reason: string
          out_sort_order: number
        }[]
      }
      my_school_invoices: {
        Args: never
        Returns: {
          out_amount_paid: number
          out_currency: string
          out_due_at: string
          out_id: string
          out_invoice_number: string
          out_issued_at: string
          out_period_end: string
          out_period_start: string
          out_pricing_model: string
          out_status: string
          out_student_count: number
          out_subtotal: number
          out_tax_amount: number
          out_tier_name: string
          out_total: number
          out_unit_price: number
        }[]
      }
      my_schools: {
        Args: never
        Returns: {
          out_clerk_org_id: string
          out_relationship: string
          out_school_code: string
          out_school_name: string
          out_school_uuid: string
        }[]
      }
      my_teacher_hub: {
        Args: never
        Returns: {
          account: Json
          entitlement: Json
          plans: Json
        }[]
      }
      network_billing_summary: {
        Args: never
        Returns: {
          out_billed: number
          out_invoices: number
          out_outstanding: number
          out_overdue: number
          out_paid: number
          out_school_code: string
          out_school_name: string
          out_school_uuid: string
        }[]
      }
      network_overview: {
        Args: never
        Returns: {
          out_attendance_rate: number
          out_collection_rate: number
          out_fees_billed: number
          out_fees_collected: number
          out_fees_outstanding: number
          out_pupils: number
          out_schools: number
          out_schools_at_capacity: number
          out_staff: number
        }[]
      }
      network_reaches_school: {
        Args: { p_school_id: string }
        Returns: boolean
      }
      network_school_summary: {
        Args: never
        Returns: {
          out_at_capacity: boolean
          out_attendance_rate: number
          out_capacity: number
          out_city_code: string
          out_clerk_org_id: string
          out_collection_rate: number
          out_fees_billed: number
          out_fees_collected: number
          out_fees_outstanding: number
          out_pupils: number
          out_results_published: number
          out_school_code: string
          out_school_name: string
          out_school_uuid: string
          out_staff: number
          out_status: string
          out_tier: string
        }[]
      }
      next_student_sequence: { Args: { p_school_id: string }; Returns: number }
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
      platform_metrics: {
        Args: never
        Returns: {
          arrears_total: number
          collected_this_month: number
          outstanding_total: number
          payments_pending: number
          schools_active: number
          schools_suspended: number
          schools_total: number
          schools_trial: number
          staff_total: number
          students_total: number
        }[]
      }
      platform_setting: { Args: { p_key: string }; Returns: string }
      promote_students: {
        Args: { p_dry_run?: boolean }
        Returns: {
          out_applied: boolean
          out_from_grade: string
          out_is_final: boolean
          out_pupils: number
          out_to_grade: string
        }[]
      }
      province_for_city: { Args: { p_city_code: string }; Returns: string }
      publish_results: {
        Args: {
          p_academic_year: string
          p_class_id?: string
          p_term_number: number
        }
        Returns: number
      }
      record_generated_document: {
        Args: {
          p_academic_year?: string
          p_doc_type: string
          p_generated_by?: string
          p_payment_id?: string
          p_school_id: string
          p_student_id?: string
          p_term_number?: number
        }
        Returns: string
      }
      record_job_run: {
        Args: {
          p_job_type: string
          p_queue_job_id?: string
          p_reference_id?: string
          p_reference_type?: string
          p_school_id: string
        }
        Returns: string
      }
      record_message_dispatch: {
        Args: {
          p_channel: string
          p_consumed_quota?: boolean
          p_fallback_of?: string
          p_is_fallback?: boolean
          p_recipient_email?: string
          p_recipient_phone?: string
          p_recipient_user?: string
          p_school_id: string
          p_status?: string
          p_student_id?: string
          p_template_key: string
          p_variables?: Json
        }
        Returns: string
      }
      record_network_school_access: {
        Args: { p_email: string; p_school_id: string }
        Returns: {
          attached_at: string
          attached_by: string | null
          created_at: string
          detached_at: string | null
          id: string
          is_active: boolean
          network_id: string
          owner_access_granted_at: string | null
          owner_access_granted_by: string | null
          owner_access_invited_email: string | null
          school_id: string
        }
        SetofOptions: {
          from: "*"
          to: "school_network_schools"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_platform_incident: {
        Args: {
          p_dedupe_key: string
          p_detail?: string
          p_feature_key?: string
          p_is_school_visible?: boolean
          p_kind: string
          p_metadata?: Json
          p_school_id?: string
          p_severity?: string
          p_source: string
          p_title: string
        }
        Returns: string
      }
      refresh_onboarding_checklist: {
        Args: { p_school_id?: string }
        Returns: {
          out_complete: boolean
          out_item: string
        }[]
      }
      register_push_token: {
        Args: { p_platform: string; p_push_token: string }
        Returns: {
          created_at: string
          id: string
          is_active: boolean
          last_seen_at: string
          parent_user_id: string
          platform: string
          push_token: string
          retired_at: string | null
          retired_reason: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "parent_push_tokens"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      register_school: {
        Args: {
          p_city_code: string
          p_country_code?: string
          p_level: string
          p_name: string
          p_owner_email: string
          p_owner_first_name: string
          p_owner_last_name: string
          p_owner_phone_e164?: string
          p_province_code: string
          p_referral_source?: string
          p_type: string
        }
        Returns: {
          out_clerk_slug: string
          out_id: string
          out_school_id: string
          out_trial_ends_at: string
        }[]
      }
      request_my_erasure: {
        Args: { p_reason?: string }
        Returns: {
          out_action_after: string
          out_done: boolean
          out_message: string
        }[]
      }
      request_parent_link_by_phone: {
        Args: { p_phone: string }
        Returns: {
          out_message: string
          out_submitted: boolean
        }[]
      }
      request_school_link: {
        Args: {
          p_email: string
          p_full_name: string
          p_note?: string
          p_school_code: string
        }
        Returns: {
          out_message: string
          out_request_id: string
          out_submitted: boolean
        }[]
      }
      resolve_notification_template: {
        Args: {
          p_channel: string
          p_language?: string
          p_school_id: string
          p_template_key: string
        }
        Returns: {
          body: string
          is_school_override: boolean
          meta_template_name: string
          subject: string
          template_id: string
        }[]
      }
      retire_push_token: { Args: { p_push_token: string }; Returns: boolean }
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
      revise_grading_scale: {
        Args: {
          p_credit_mark?: number
          p_grade_bands: Json
          p_pass_mark?: number
          p_reason?: string
          p_scale_id: string
        }
        Returns: {
          created_at: string
          created_by_user_id: string | null
          credit_mark: number | null
          effective_from: string
          grade_bands: Json
          grading_scale_id: string
          id: string
          pass_mark: number | null
          revision_reason: string | null
          school_id: string
          superseded_at: string | null
          version_number: number
        }
        SetofOptions: {
          from: "*"
          to: "school_grading_scale_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_exam_marks: {
        Args: {
          p_academic_year: string
          p_class_id: string
          p_marks: Json
          p_marks_total: number
          p_subject_code: string
          p_subject_name: string
          p_term_number: number
        }
        Returns: {
          graded_count: number
          saved_count: number
        }[]
      }
      school_assign_credits: {
        Args: { p_purchase_id: string; p_user_ids: string[] }
        Returns: {
          out_assigned: number
          out_unassigned_remaining: number
        }[]
      }
      school_branding_by_slug: { Args: { p_slug: string }; Returns: Json }
      school_can_enrol: { Args: { p_school_id: string }; Returns: boolean }
      school_can_write: { Args: { p_school_id: string }; Returns: boolean }
      school_class_readiness: {
        Args: { p_academic_year?: string; p_term_number?: number }
        Returns: {
          out_class_id: string
          out_grade_id: string
          out_marks_missing: number
          out_pupils: number
          out_register_days: number
          out_register_days_missing: number
          out_subjects_assigned: number
          out_subjects_with_marks: number
        }[]
      }
      school_credit_period: {
        Args: { p_from?: string; p_period_kind: string; p_school_id: string }
        Returns: {
          out_period_end: string
          out_period_start: string
        }[]
      }
      school_credit_plan_catalogue: {
        Args: never
        Returns: {
          out_credits_per_seat: number
          out_currency_code: string
          out_display_name: string
          out_period_kind: string
          out_plan_code: string
          out_price_per_seat: number
        }[]
      }
      school_credit_quote: {
        Args: { p_plan_code: string; p_seats: number }
        Returns: {
          out_credits_per_seat: number
          out_currency_code: string
          out_display_name: string
          out_period_end: string
          out_period_kind: string
          out_period_start: string
          out_plan_code: string
          out_price_per_seat: number
          out_seats: number
          out_total_amount: number
          out_total_credits: number
        }[]
      }
      school_credit_unassigned: {
        Args: { p_purchase_id: string }
        Returns: number
      }
      school_credit_usage: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          out_actions: number
          out_allocated: number
          out_clerk_user_id: string
          out_credits_spent: number
          out_from_reserve: number
          out_last_used_at: string
          out_teacher_name: string
        }[]
      }
      school_decide_join_request: {
        Args: { p_approve: boolean; p_request_id: string; p_role?: string }
        Returns: {
          out_clerk_org_id: string
          out_decided: boolean
          out_granted_role: string
          out_requester_email: string
          out_requester_name: string
          out_school_id: string
        }[]
      }
      school_decide_parent_claim: {
        Args: { p_approve: boolean; p_claim_id: string }
        Returns: {
          out_decided: boolean
          out_linked: boolean
        }[]
      }
      school_fee_summary: {
        Args: { p_filter?: string; p_search?: string }
        Returns: {
          out_arrears: number
          out_outstanding: number
          out_pupils_overdue: number
          out_pupils_owing: number
          out_total_pupils: number
        }[]
      }
      school_has_feature: {
        Args: { p_feature_key: string; p_school_id: string }
        Returns: boolean
      }
      school_health_scores: {
        Args: never
        Returns: {
          band: string
          composite_score: number
          engagement_score: number
          financial_score: number
          inputs_available: number
          inputs_total: number
          operational_score: number
          school_code: string
          school_id: string
          school_name: string
          status: string
          students: number
          subscription_tier: string
        }[]
      }
      school_onboarding_completion: {
        Args: { p_school_id: string }
        Returns: {
          completed_weight: number
          completion_pct: number
          critical_pct: number
          items_complete: number
          items_total: number
          total_weight: number
        }[]
      }
      school_public_profile: {
        Args: { p_school_code: string }
        Returns: {
          out_about: string
          out_avg_class_size: number
          out_city_code: string
          out_established_year: number
          out_fee_band_max: number
          out_fee_band_min: number
          out_grade_levels: string[]
          out_has_boarding: boolean
          out_has_computer_lab: boolean
          out_has_feeding: boolean
          out_has_library: boolean
          out_has_science_lab: boolean
          out_has_special_needs: boolean
          out_has_sports: boolean
          out_has_transport: boolean
          out_level: string
          out_logo_url: string
          out_name: string
          out_province_code: string
          out_pupils_per_teacher: number
          out_school_code: string
          out_status: string
          out_type: string
          out_website_url: string
        }[]
      }
      school_purchase_credits: {
        Args: { p_plan_code: string; p_seats: number }
        Returns: {
          out_invoice_id: string
          out_period_end: string
          out_period_start: string
          out_purchase_id: string
          out_total_amount: number
          out_total_credits: number
        }[]
      }
      school_revoke_credit_assignment: {
        Args: { p_assignment_id: string }
        Returns: {
          out_credits_returned: number
          out_revoked: boolean
        }[]
      }
      school_set_credit_reserve: {
        Args: { p_enabled: boolean; p_per_teacher_cap?: number }
        Returns: {
          out_reserve_enabled: boolean
          out_reserve_per_teacher_cap: number
        }[]
      }
      school_settings_history: {
        Args: { p_limit?: number; p_school_id?: string }
        Returns: {
          out_action: string
          out_actor: string
          out_actor_name: string
          out_changed: Json
          out_created_at: string
          out_id: string
          out_impersonated: string
          out_table_name: string
        }[]
      }
      school_student_capacity: {
        Args: { p_school_id: string }
        Returns: {
          at_capacity: boolean
          current_count: number
          is_unlimited: boolean
          remaining: number
          source: string
          student_limit: number
        }[]
      }
      school_student_limit: {
        Args: { p_school_id: string }
        Returns: {
          is_unlimited: boolean
          source: string
          student_limit: number
        }[]
      }
      school_subscription_charge: {
        Args: { p_currency?: string; p_school_id: string }
        Returns: {
          out_amount: number
          out_currency: string
          out_pricing_model: string
          out_reason: string
          out_student_count: number
          out_tier: string
          out_unit_price: number
        }[]
      }
      school_verified_metrics: {
        Args: { p_school_id: string }
        Returns: {
          out_avg_class_size: number
          out_classes: number
          out_pupils: number
          out_pupils_per_teacher: number
          out_teachers: number
        }[]
      }
      search_schools: {
        Args: {
          p_boarding?: boolean
          p_city?: string
          p_country_code?: string
          p_fee_max?: number
          p_level?: string
          p_limit?: number
          p_offset?: number
          p_province?: string
          p_search?: string
          p_transport?: boolean
          p_type?: string
        }
        Returns: {
          out_about: string
          out_avg_class_size: number
          out_city_code: string
          out_fee_band_max: number
          out_fee_band_min: number
          out_has_boarding: boolean
          out_has_transport: boolean
          out_level: string
          out_logo_url: string
          out_name: string
          out_province_code: string
          out_pupils_per_teacher: number
          out_school_code: string
          out_status: string
          out_total: number
          out_type: string
        }[]
      }
      set_incident_status: {
        Args: { p_incident_id: string; p_note?: string; p_status: string }
        Returns: boolean
      }
      set_onboarding_override: {
        Args: {
          p_item_key: string
          p_override: boolean
          p_reason?: string
          p_school_id: string
        }
        Returns: {
          out_done: boolean
          out_message: string
        }[]
      }
      set_school_public_profile: {
        Args: {
          p_about?: string
          p_established_year?: number
          p_fee_band_max?: number
          p_fee_band_min?: number
          p_has_boarding?: boolean
          p_has_computer_lab?: boolean
          p_has_feeding?: boolean
          p_has_library?: boolean
          p_has_science_lab?: boolean
          p_has_special_needs?: boolean
          p_has_sports?: boolean
          p_has_transport?: boolean
          p_is_published?: boolean
          p_publish_class_sizes?: boolean
          p_publish_fee_band?: boolean
          p_publish_ratio?: boolean
          p_website_url?: string
        }
        Returns: {
          about: string | null
          created_at: string
          established_year: number | null
          fee_band_max: number | null
          fee_band_min: number | null
          has_boarding: boolean
          has_computer_lab: boolean
          has_feeding: boolean
          has_library: boolean
          has_science_lab: boolean
          has_special_needs: boolean
          has_sports: boolean
          has_transport: boolean
          is_published: boolean
          publish_class_sizes: boolean
          publish_fee_band: boolean
          publish_ratio: boolean
          school_id: string
          updated_at: string
          updated_by: string | null
          website_url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "school_public_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      srgb_relative_luminance: { Args: { p_hex: string }; Returns: number }
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
      teacher_credit_balances: {
        Args: never
        Returns: {
          out_personal_available: number
          out_reserve_available: number
          out_school_allocated: number
          out_school_available: number
          out_school_expires_on: string
          out_school_id: string
          out_school_name: string
          out_school_spent: number
        }[]
      }
      teacher_hub_activate_subscription: {
        Args: {
          p_clerk_user_id: string
          p_paid_until?: string
          p_plan_code: string
        }
        Returns: string
      }
      teacher_hub_cancel_subscription: { Args: never; Returns: string }
      teacher_hub_entitlement: {
        Args: { p_clerk_user_id?: string }
        Returns: {
          allowance: number
          may_generate: boolean
          plan_code: string
          reason: string
          remaining: number
          subscription_ends_at: string
          subscription_status: string
          used: number
        }[]
      }
      teacher_reaches_class: { Args: { p_class_id: string }; Returns: boolean }
      teacher_school_entitlement: {
        Args: never
        Returns: {
          out_assignment_id: string
          out_available: number
          out_from_reserve: boolean
        }[]
      }
      teacher_teaches_subject: {
        Args: { p_class_id: string; p_subject_code: string }
        Returns: boolean
      }
      teacher_teaches_subject_in_year: {
        Args: {
          p_academic_year: string
          p_class_id: string
          p_subject_code: string
        }
        Returns: boolean
      }
      teaching_resource_feature_key: {
        Args: { p_resource_kind: string }
        Returns: string
      }
      transfer_student: {
        Args: {
          p_destination?: string
          p_kind?: string
          p_reason: string
          p_student_id: string
        }
        Returns: {
          out_access_until: string
          out_done: boolean
          out_message: string
        }[]
      }
      unlink_parent_from_student: {
        Args: { p_link_id: string }
        Returns: {
          out_access_until: string
          out_unlinked: boolean
        }[]
      }
      unlock_result_for_correction: {
        Args: { p_reason: string; p_result_id: string }
        Returns: {
          out_message: string
          out_unlocked: boolean
        }[]
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
      wcag_contrast_ratio: {
        Args: { p_a: string; p_b: string }
        Returns: number
      }
      withdraw_my_erasure: {
        Args: never
        Returns: {
          out_done: boolean
          out_message: string
        }[]
      }
      withdraw_school_link_request: {
        Args: { p_request_id: string }
        Returns: boolean
      }
      worker_announcement_recipients: {
        Args: { p_announcement_id: string; p_limit?: number }
        Returns: {
          out_email: string
          out_name: string
          out_phone: string
          out_student_id: string
          out_user_id: string
        }[]
      }
      worker_claim_scheduled_announcements: {
        Args: { p_limit?: number }
        Returns: {
          out_announcement_id: string
          out_body: string
          out_school_id: string
          out_target_ids: string[]
          out_target_type: string
          out_title: string
        }[]
      }
      worker_complete_announcement: {
        Args: {
          p_announcement_id: string
          p_jobs_queued?: number
          p_status: string
        }
        Returns: undefined
      }
      worker_due_fee_reminders: {
        Args: {
          p_cooldown_days?: number
          p_limit?: number
          p_min_days_overdue?: number
          p_school_id?: string
        }
        Returns: {
          out_arrears_amount: string
          out_currency: string
          out_days_overdue: number
          out_fee_record_id: string
          out_parent_email: string
          out_parent_name: string
          out_parent_phone: string
          out_parent_user_id: string
          out_school_id: string
          out_school_name: string
          out_student_id: string
          out_student_name: string
        }[]
      }
      worker_mark_reminder_sent: {
        Args: { p_fee_record_id: string }
        Returns: undefined
      }
      worker_parent_push_tokens: {
        Args: { p_parent_user_ids: string[] }
        Returns: {
          out_parent_user_id: string
          out_platform: string
          out_push_token: string
        }[]
      }
      worker_payment_context: { Args: { p_payment_id: string }; Returns: Json }
      worker_report_card_batch: {
        Args: {
          p_academic_year: string
          p_class_id?: string
          p_school_id: string
          p_term_number: number
        }
        Returns: {
          out_class_id: string
          out_student_code: string
          out_student_id: string
          out_student_name: string
          out_subjects: Json
        }[]
      }
      worker_retire_push_token: {
        Args: { p_push_token: string; p_reason?: string }
        Returns: boolean
      }
      worker_school_branding: { Args: { p_school_id: string }; Returns: Json }
      worker_update_dispatch: {
        Args: {
          p_failure_reason?: string
          p_message_log_id: string
          p_provider_message_id?: string
          p_status: string
        }
        Returns: undefined
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
