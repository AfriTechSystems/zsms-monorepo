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
      announcements: {
        Row: {
          body: string
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
          updated_at?: string
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
      admin_revoke_override: {
        Args: { p_actor: string; p_id: string }
        Returns: boolean
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
          p_units?: number
        }
        Returns: {
          credits_charged: number
          funded_allowance: number
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
      detach_school_from_network: {
        Args: { p_school_id: string }
        Returns: boolean
      }
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
      school_branding_by_slug: { Args: { p_slug: string }; Returns: Json }
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
