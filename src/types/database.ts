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
    PostgrestVersion: "14.4"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activities: {
        Row: {
          agent_generated: boolean
          agent_id: string | null
          body: string | null
          company_id: string | null
          contact_id: string | null
          created_at: string
          deal_id: string | null
          direction: string | null
          duration_secs: number | null
          id: string
          metadata: Json
          occurred_at: string
          org_id: string
          owner_id: string | null
          sentiment_score: number | null
          sentiment_state: string | null
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          agent_generated?: boolean
          agent_id?: string | null
          body?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          direction?: string | null
          duration_secs?: number | null
          id?: string
          metadata?: Json
          occurred_at?: string
          org_id: string
          owner_id?: string | null
          sentiment_score?: number | null
          sentiment_state?: string | null
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          agent_generated?: boolean
          agent_id?: string | null
          body?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          direction?: string | null
          duration_secs?: number | null
          id?: string
          metadata?: Json
          occurred_at?: string
          org_id?: string
          owner_id?: string | null
          sentiment_score?: number | null
          sentiment_state?: string | null
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_actions: {
        Row: {
          action_type: string
          agent_type: string
          approved_at: string | null
          approved_by: string | null
          completed_at: string | null
          contact_id: string | null
          created_at: string
          deal_id: string | null
          error_message: string | null
          id: string
          org_id: string
          payload: Json
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          result: Json | null
          retry_count: number
          scheduled_for: string | null
          started_at: string | null
          status: string
        }
        Insert: {
          action_type: string
          agent_type: string
          approved_at?: string | null
          approved_by?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          error_message?: string | null
          id?: string
          org_id: string
          payload?: Json
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          result?: Json | null
          retry_count?: number
          scheduled_for?: string | null
          started_at?: string | null
          status?: string
        }
        Update: {
          action_type?: string
          agent_type?: string
          approved_at?: string | null
          approved_by?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          error_message?: string | null
          id?: string
          org_id?: string
          payload?: Json
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          result?: Json | null
          retry_count?: number
          scheduled_for?: string | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_actions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_actions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_actions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_actions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_actions_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_configs: {
        Row: {
          agent_type: string
          config: Json
          created_at: string
          created_by: string | null
          id: string
          is_enabled: boolean
          mode: string
          name: string
          org_id: string
          schedule: string | null
          updated_at: string
        }
        Insert: {
          agent_type: string
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_enabled?: boolean
          mode?: string
          name: string
          org_id: string
          schedule?: string | null
          updated_at?: string
        }
        Update: {
          agent_type?: string
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_enabled?: boolean
          mode?: string
          name?: string
          org_id?: string
          schedule?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_configs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_configs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          actions_created: number
          actions_executed: number
          agent_type: string
          completed_at: string | null
          error_message: string | null
          id: string
          metadata: Json
          org_id: string
          started_at: string
          status: string
          summary: string | null
          trigger_type: string
        }
        Insert: {
          actions_created?: number
          actions_executed?: number
          agent_type: string
          completed_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json
          org_id: string
          started_at?: string
          status?: string
          summary?: string | null
          trigger_type: string
        }
        Update: {
          actions_created?: number
          actions_executed?: number
          agent_type?: string
          completed_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json
          org_id?: string
          started_at?: string
          status?: string
          summary?: string | null
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      buyer_personas: {
        Row: {
          communication_preferences: Json
          confidence: number
          contact_id: string
          created_at: string
          decision_style: string | null
          disc_compliance: number | null
          disc_dominant: number | null
          disc_influence: number | null
          disc_steadiness: number | null
          id: string
          interactions_analyzed: number
          last_updated_at: string
          motivators: string[]
          org_id: string
          primary_style: string | null
          risk_tolerance: string | null
        }
        Insert: {
          communication_preferences?: Json
          confidence?: number
          contact_id: string
          created_at?: string
          decision_style?: string | null
          disc_compliance?: number | null
          disc_dominant?: number | null
          disc_influence?: number | null
          disc_steadiness?: number | null
          id?: string
          interactions_analyzed?: number
          last_updated_at?: string
          motivators?: string[]
          org_id: string
          primary_style?: string | null
          risk_tolerance?: string | null
        }
        Update: {
          communication_preferences?: Json
          confidence?: number
          contact_id?: string
          created_at?: string
          decision_style?: string | null
          disc_compliance?: number | null
          disc_dominant?: number | null
          disc_influence?: number | null
          disc_steadiness?: number | null
          id?: string
          interactions_analyzed?: number
          last_updated_at?: string
          motivators?: string[]
          org_id?: string
          primary_style?: string | null
          risk_tolerance?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "buyer_personas_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyer_personas_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      call_recordings: {
        Row: {
          action_items: Json
          activity_id: string | null
          contact_id: string | null
          created_at: string
          deal_id: string | null
          duration_secs: number | null
          highlights: Json
          id: string
          org_id: string
          processed_at: string | null
          sentiment_score: number | null
          sentiment_state: string | null
          speaker_sentiments: Json
          storage_path: string | null
          summary: string | null
          transcript: string | null
          transcript_status: string
        }
        Insert: {
          action_items?: Json
          activity_id?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          duration_secs?: number | null
          highlights?: Json
          id?: string
          org_id: string
          processed_at?: string | null
          sentiment_score?: number | null
          sentiment_state?: string | null
          speaker_sentiments?: Json
          storage_path?: string | null
          summary?: string | null
          transcript?: string | null
          transcript_status?: string
        }
        Update: {
          action_items?: Json
          activity_id?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          duration_secs?: number | null
          highlights?: Json
          id?: string
          org_id?: string
          processed_at?: string | null
          sentiment_score?: number | null
          sentiment_state?: string | null
          speaker_sentiments?: Json
          storage_path?: string | null
          summary?: string | null
          transcript?: string | null
          transcript_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_recordings_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_recordings_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_recordings_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_recordings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cnae_codes: {
        Row: {
          class_name: string | null
          code: string
          description: string
          division: string | null
          group_name: string | null
          is_active: boolean
          section: string | null
        }
        Insert: {
          class_name?: string | null
          code: string
          description: string
          division?: string | null
          group_name?: string | null
          is_active?: boolean
          section?: string | null
        }
        Update: {
          class_name?: string | null
          code?: string
          description?: string
          division?: string | null
          group_name?: string | null
          is_active?: boolean
          section?: string | null
        }
        Relationships: []
      }
      companies: {
        Row: {
          annual_revenue: number | null
          apify_run_id: string | null
          city: string | null
          cnae_code: string | null
          cnae_description: string | null
          cnpj: string | null
          country: string | null
          created_at: string
          deal_value: number | null
          description: string | null
          domain: string | null
          embedding: string | null
          enriched_at: string | null
          enrichment_data: Json
          google_place_id: string | null
          id: string
          industry: string | null
          is_deleted: boolean
          lead_origin: string | null
          linkedin_company_id: string | null
          linkedin_employee_count: number | null
          linkedin_followers: number | null
          linkedin_scraped_at: string | null
          linkedin_url: string | null
          logo_url: string | null
          meta_ad_id: string | null
          meta_adset_id: string | null
          meta_campaign_id: string | null
          name: string
          org_id: string
          owner_id: string | null
          size_range: string | null
          source: string | null
          status: string | null
          tags: string[]
          traffic_source: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          annual_revenue?: number | null
          apify_run_id?: string | null
          city?: string | null
          cnae_code?: string | null
          cnae_description?: string | null
          cnpj?: string | null
          country?: string | null
          created_at?: string
          deal_value?: number | null
          description?: string | null
          domain?: string | null
          embedding?: string | null
          enriched_at?: string | null
          enrichment_data?: Json
          google_place_id?: string | null
          id?: string
          industry?: string | null
          is_deleted?: boolean
          lead_origin?: string | null
          linkedin_company_id?: string | null
          linkedin_employee_count?: number | null
          linkedin_followers?: number | null
          linkedin_scraped_at?: string | null
          linkedin_url?: string | null
          logo_url?: string | null
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          name: string
          org_id: string
          owner_id?: string | null
          size_range?: string | null
          source?: string | null
          status?: string | null
          tags?: string[]
          traffic_source?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          annual_revenue?: number | null
          apify_run_id?: string | null
          city?: string | null
          cnae_code?: string | null
          cnae_description?: string | null
          cnpj?: string | null
          country?: string | null
          created_at?: string
          deal_value?: number | null
          description?: string | null
          domain?: string | null
          embedding?: string | null
          enriched_at?: string | null
          enrichment_data?: Json
          google_place_id?: string | null
          id?: string
          industry?: string | null
          is_deleted?: boolean
          lead_origin?: string | null
          linkedin_company_id?: string | null
          linkedin_employee_count?: number | null
          linkedin_followers?: number | null
          linkedin_scraped_at?: string | null
          linkedin_url?: string | null
          logo_url?: string | null
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          name?: string
          org_id?: string
          owner_id?: string | null
          size_range?: string | null
          source?: string | null
          status?: string | null
          tags?: string[]
          traffic_source?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companies_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          apify_run_id: string | null
          avatar_url: string | null
          company_id: string | null
          created_at: string
          department: string | null
          do_not_contact: boolean
          email: string | null
          embedding: string | null
          enriched_at: string | null
          enrichment_data: Json
          first_name: string
          id: string
          instagram_handle: string | null
          is_deleted: boolean
          last_name: string | null
          linkedin_connection: string | null
          linkedin_headline: string | null
          linkedin_profile_id: string | null
          linkedin_scraped_at: string | null
          linkedin_skills: string[]
          linkedin_summary: string | null
          linkedin_url: string | null
          mobile: string | null
          org_id: string
          owner_id: string | null
          phone: string | null
          preferred_channel: string | null
          seniority: string | null
          source: string | null
          tags: string[]
          timezone: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          apify_run_id?: string | null
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          department?: string | null
          do_not_contact?: boolean
          email?: string | null
          embedding?: string | null
          enriched_at?: string | null
          enrichment_data?: Json
          first_name: string
          id?: string
          instagram_handle?: string | null
          is_deleted?: boolean
          last_name?: string | null
          linkedin_connection?: string | null
          linkedin_headline?: string | null
          linkedin_profile_id?: string | null
          linkedin_scraped_at?: string | null
          linkedin_skills?: string[]
          linkedin_summary?: string | null
          linkedin_url?: string | null
          mobile?: string | null
          org_id: string
          owner_id?: string | null
          phone?: string | null
          preferred_channel?: string | null
          seniority?: string | null
          source?: string | null
          tags?: string[]
          timezone?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          apify_run_id?: string | null
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          department?: string | null
          do_not_contact?: boolean
          email?: string | null
          embedding?: string | null
          enriched_at?: string | null
          enrichment_data?: Json
          first_name?: string
          id?: string
          instagram_handle?: string | null
          is_deleted?: boolean
          last_name?: string | null
          linkedin_connection?: string | null
          linkedin_headline?: string | null
          linkedin_profile_id?: string | null
          linkedin_scraped_at?: string | null
          linkedin_skills?: string[]
          linkedin_summary?: string | null
          linkedin_url?: string | null
          mobile?: string | null
          org_id?: string
          owner_id?: string | null
          phone?: string | null
          preferred_channel?: string | null
          seniority?: string | null
          source?: string | null
          tags?: string[]
          timezone?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_contacts: {
        Row: {
          contact_id: string
          created_at: string
          deal_id: string
          is_primary: boolean
          role: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          deal_id: string
          is_primary?: boolean
          role?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          deal_id?: string
          is_primary?: boolean
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_contacts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          actual_close: string | null
          company_id: string | null
          created_at: string
          currency: string
          custom_fields: Json
          expected_close: string | null
          id: string
          is_deleted: boolean
          last_activity_at: string | null
          lost_reason: string | null
          org_id: string
          owner_id: string | null
          pipeline_id: string
          probability: number | null
          sentiment_score: number | null
          sentiment_state: string | null
          sentiment_updated_at: string | null
          sniper_score: number | null
          sniper_updated_at: string | null
          source: string | null
          stage_id: string
          status: string
          tags: string[]
          title: string
          updated_at: string
          value: number
        }
        Insert: {
          actual_close?: string | null
          company_id?: string | null
          created_at?: string
          currency?: string
          custom_fields?: Json
          expected_close?: string | null
          id?: string
          is_deleted?: boolean
          last_activity_at?: string | null
          lost_reason?: string | null
          org_id: string
          owner_id?: string | null
          pipeline_id: string
          probability?: number | null
          sentiment_score?: number | null
          sentiment_state?: string | null
          sentiment_updated_at?: string | null
          sniper_score?: number | null
          sniper_updated_at?: string | null
          source?: string | null
          stage_id: string
          status?: string
          tags?: string[]
          title: string
          updated_at?: string
          value?: number
        }
        Update: {
          actual_close?: string | null
          company_id?: string | null
          created_at?: string
          currency?: string
          custom_fields?: Json
          expected_close?: string | null
          id?: string
          is_deleted?: boolean
          last_activity_at?: string | null
          lost_reason?: string | null
          org_id?: string
          owner_id?: string | null
          pipeline_id?: string
          probability?: number | null
          sentiment_score?: number | null
          sentiment_state?: string | null
          sentiment_updated_at?: string | null
          sniper_score?: number | null
          sniper_updated_at?: string | null
          source?: string | null
          stage_id?: string
          status?: string
          tags?: string[]
          title?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      email_threads: {
        Row: {
          contact_id: string | null
          created_at: string
          deal_id: string | null
          external_id: string | null
          id: string
          last_message_at: string | null
          message_count: number
          org_id: string
          owner_id: string | null
          provider: string
          subject: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          external_id?: string | null
          id?: string
          last_message_at?: string | null
          message_count?: number
          org_id: string
          owner_id?: string | null
          provider: string
          subject?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          external_id?: string | null
          id?: string
          last_message_at?: string | null
          message_count?: number
          org_id?: string
          owner_id?: string | null
          provider?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_threads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      emotion_maps: {
        Row: {
          contact_id: string | null
          deal_id: string
          id: string
          org_id: string
          recorded_at: string
          score: number
          stage_id: string | null
          state: string
          trigger_event: string | null
        }
        Insert: {
          contact_id?: string | null
          deal_id: string
          id?: string
          org_id: string
          recorded_at?: string
          score: number
          stage_id?: string | null
          state: string
          trigger_event?: string | null
        }
        Update: {
          contact_id?: string | null
          deal_id?: string
          id?: string
          org_id?: string
          recorded_at?: string
          score?: number
          stage_id?: string | null
          state?: string
          trigger_event?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "emotion_maps_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emotion_maps_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emotion_maps_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emotion_maps_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_runs: {
        Row: {
          apify_actor_id: string | null
          apify_run_id: string | null
          cnae_codes: string[] | null
          companies_created: number
          completed_at: string | null
          contacts_created: number
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          location: string | null
          max_results: number
          org_id: string
          query: string | null
          raw_data: Json | null
          results_count: number
          source: string
          started_at: string | null
          status: string
        }
        Insert: {
          apify_actor_id?: string | null
          apify_run_id?: string | null
          cnae_codes?: string[] | null
          companies_created?: number
          completed_at?: string | null
          contacts_created?: number
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          location?: string | null
          max_results?: number
          org_id: string
          query?: string | null
          raw_data?: Json | null
          results_count?: number
          source: string
          started_at?: string | null
          status?: string
        }
        Update: {
          apify_actor_id?: string | null
          apify_run_id?: string | null
          cnae_codes?: string[] | null
          companies_created?: number
          completed_at?: string | null
          contacts_created?: number
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          location?: string | null
          max_results?: number
          org_id?: string
          query?: string | null
          raw_data?: Json | null
          results_count?: number
          source?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hit_lists: {
        Row: {
          generated_at: string
          id: string
          items: Json
          list_date: string
          org_id: string
          owner_id: string
        }
        Insert: {
          generated_at?: string
          id?: string
          items?: Json
          list_date?: string
          org_id: string
          owner_id: string
        }
        Update: {
          generated_at?: string
          id?: string
          items?: Json
          list_date?: string
          org_id?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hit_lists_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hit_lists_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      icp_profiles: {
        Row: {
          created_at: string
          created_by: string | null
          criteria: Json
          id: string
          is_active: boolean
          name: string
          org_id: string
          target_cities: string[]
          target_cnaes: string[]
          target_instagram_keywords: string[]
          target_linkedin_companies: string[]
          target_linkedin_skills: string[]
          target_linkedin_titles: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          criteria?: Json
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          target_cities?: string[]
          target_cnaes?: string[]
          target_instagram_keywords?: string[]
          target_linkedin_companies?: string[]
          target_linkedin_skills?: string[]
          target_linkedin_titles?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          criteria?: Json
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          target_cities?: string[]
          target_cnaes?: string[]
          target_instagram_keywords?: string[]
          target_linkedin_companies?: string[]
          target_linkedin_skills?: string[]
          target_linkedin_titles?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "icp_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "icp_profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          access_token: string | null
          config: Json
          created_at: string
          error_message: string | null
          id: string
          last_sync_at: string | null
          org_id: string
          provider: string
          refresh_token: string | null
          status: string
          token_expires_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_token?: string | null
          config?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          last_sync_at?: string | null
          org_id: string
          provider: string
          refresh_token?: string | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_token?: string | null
          config?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          last_sync_at?: string | null
          org_id?: string
          provider?: string
          refresh_token?: string | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integrations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          org_id: string
          role: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          org_id: string
          role?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          org_id?: string
          role?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      linkedin_messages: {
        Row: {
          agent_action_id: string | null
          agent_generated: boolean
          body: string
          contact_id: string | null
          created_at: string
          direction: string
          id: string
          org_id: string
          sent_at: string
          sentiment_score: number | null
          sentiment_state: string | null
          thread_id: string
        }
        Insert: {
          agent_action_id?: string | null
          agent_generated?: boolean
          body: string
          contact_id?: string | null
          created_at?: string
          direction: string
          id?: string
          org_id: string
          sent_at: string
          sentiment_score?: number | null
          sentiment_state?: string | null
          thread_id: string
        }
        Update: {
          agent_action_id?: string | null
          agent_generated?: boolean
          body?: string
          contact_id?: string | null
          created_at?: string
          direction?: string
          id?: string
          org_id?: string
          sent_at?: string
          sentiment_score?: number | null
          sentiment_state?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "linkedin_messages_agent_action_id_fkey"
            columns: ["agent_action_id"]
            isOneToOne: false
            referencedRelation: "agent_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkedin_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkedin_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkedin_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "linkedin_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      linkedin_threads: {
        Row: {
          contact_id: string | null
          created_at: string
          deal_id: string | null
          id: string
          last_message_at: string | null
          linkedin_thread_id: string | null
          message_count: number
          org_id: string
          owner_id: string | null
          sentiment_score: number | null
          sentiment_state: string | null
          updated_at: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          last_message_at?: string | null
          linkedin_thread_id?: string | null
          message_count?: number
          org_id: string
          owner_id?: string | null
          sentiment_score?: number | null
          sentiment_state?: string | null
          updated_at?: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          last_message_at?: string | null
          linkedin_thread_id?: string | null
          message_count?: number
          org_id?: string
          owner_id?: string | null
          sentiment_score?: number | null
          sentiment_state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "linkedin_threads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkedin_threads_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkedin_threads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkedin_threads_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          domain: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          metadata: Json
          name: string
          plan: string
          plan_seats: number
          settings: Json
          slug: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          domain?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          metadata?: Json
          name: string
          plan?: string
          plan_seats?: number
          settings?: Json
          slug: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          domain?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          metadata?: Json
          name?: string
          plan?: string
          plan_seats?: number
          settings?: Json
          slug?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pipeline_stages: {
        Row: {
          color: string
          created_at: string
          id: string
          is_lost: boolean
          is_won: boolean
          name: string
          org_id: string
          pipeline_id: string
          position: number
          probability: number
          rotting_days: number | null
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_lost?: boolean
          is_won?: boolean
          name: string
          org_id: string
          pipeline_id: string
          position?: number
          probability?: number
          rotting_days?: number | null
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_lost?: boolean
          is_won?: boolean
          name?: string
          org_id?: string
          pipeline_id?: string
          position?: number
          probability?: number
          rotting_days?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      pipelines: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          org_id: string
          owner_id: string | null
          position: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          org_id: string
          owner_id?: string | null
          position?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          org_id?: string
          owner_id?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipelines_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          last_seen_at: string | null
          locale: string
          onboarded_at: string | null
          org_id: string
          preferences: Json
          role: string
          timezone: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          last_seen_at?: string | null
          locale?: string
          onboarded_at?: string | null
          org_id: string
          preferences?: Json
          role?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          locale?: string
          onboarded_at?: string | null
          org_id?: string
          preferences?: Json
          role?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sentiment_analyses: {
        Row: {
          analyzed_at: string
          confidence: number
          contact_id: string | null
          deal_id: string | null
          embedding: string | null
          emotions: Json
          id: string
          key_phrases: string[]
          model_version: string
          org_id: string
          overall_score: number
          red_flags: string[]
          source_id: string
          source_type: string
          state: string
          summary: string | null
          tone_suggestion: string | null
        }
        Insert: {
          analyzed_at?: string
          confidence: number
          contact_id?: string | null
          deal_id?: string | null
          embedding?: string | null
          emotions?: Json
          id?: string
          key_phrases?: string[]
          model_version?: string
          org_id: string
          overall_score: number
          red_flags?: string[]
          source_id: string
          source_type: string
          state: string
          summary?: string | null
          tone_suggestion?: string | null
        }
        Update: {
          analyzed_at?: string
          confidence?: number
          contact_id?: string | null
          deal_id?: string | null
          embedding?: string | null
          emotions?: Json
          id?: string
          key_phrases?: string[]
          model_version?: string
          org_id?: string
          overall_score?: number
          red_flags?: string[]
          source_id?: string
          source_type?: string
          state?: string
          summary?: string | null
          tone_suggestion?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sentiment_analyses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sentiment_analyses_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sentiment_analyses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      signals: {
        Row: {
          company_id: string | null
          contact_id: string | null
          created_at: string
          data: Json
          deal_id: string | null
          detected_at: string
          id: string
          intensity: number
          org_id: string
          processed: boolean
          signal_type: string
          source: string
          triggered_action: boolean
        }
        Insert: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          data?: Json
          deal_id?: string | null
          detected_at?: string
          id?: string
          intensity?: number
          org_id: string
          processed?: boolean
          signal_type: string
          source: string
          triggered_action?: boolean
        }
        Update: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          data?: Json
          deal_id?: string | null
          detected_at?: string
          id?: string
          intensity?: number
          org_id?: string
          processed?: boolean
          signal_type?: string
          source?: string
          triggered_action?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "signals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sniper_scores: {
        Row: {
          calculated_at: string
          contact_id: string | null
          deal_id: string | null
          engagement: number
          factors: Json
          icp_fit: number
          id: string
          intent_signals: number
          org_id: string
          recommendation: string | null
          score: number
          timing: number
        }
        Insert: {
          calculated_at?: string
          contact_id?: string | null
          deal_id?: string | null
          engagement?: number
          factors?: Json
          icp_fit?: number
          id?: string
          intent_signals?: number
          org_id: string
          recommendation?: string | null
          score: number
          timing?: number
        }
        Update: {
          calculated_at?: string
          contact_id?: string | null
          deal_id?: string | null
          engagement?: number
          factors?: Json
          icp_fit?: number
          id?: string
          intent_signals?: number
          org_id?: string
          recommendation?: string | null
          score?: number
          timing?: number
        }
        Relationships: [
          {
            foreignKeyName: "sniper_scores_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sniper_scores_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sniper_scores_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          metadata: Json
          org_id: string
          plan: string
          seats: number
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_end: string | null
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          metadata?: Json
          org_id: string
          plan: string
          seats?: number
          status: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          metadata?: Json
          org_id?: string
          plan?: string
          seats?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trigger_rules: {
        Row: {
          actions: Json
          conditions: Json
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string
          score_impact: number
          updated_at: string
        }
        Insert: {
          actions?: Json
          conditions?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          score_impact?: number
          updated_at?: string
        }
        Update: {
          actions?: Json
          conditions?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          score_impact?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trigger_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trigger_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_metrics: {
        Row: {
          created_at: string
          id: string
          metric_type: string
          org_id: string
          period_end: string
          period_start: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          metric_type: string
          org_id: string
          period_end: string
          period_start: string
          value?: number
        }
        Update: {
          created_at?: string
          id?: string
          metric_type?: string
          org_id?: string
          period_end?: string
          period_start?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "usage_metrics_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks: {
        Row: {
          created_at: string
          events: string[]
          failure_count: number
          headers: Json
          id: string
          is_active: boolean
          last_triggered_at: string | null
          name: string
          org_id: string
          secret: string
          url: string
        }
        Insert: {
          created_at?: string
          events?: string[]
          failure_count?: number
          headers?: Json
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          name: string
          org_id: string
          secret?: string
          url: string
        }
        Update: {
          created_at?: string
          events?: string[]
          failure_count?: number
          headers?: Json
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          name?: string
          org_id?: string
          secret?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_org_id: { Args: never; Returns: string }
      get_user_role: { Args: never; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      unaccent: { Args: { "": string }; Returns: string }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
