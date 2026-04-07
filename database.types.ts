/**
 * database.types.ts
 *
 * TypeScript types for the Supabase database schema (project: ltibymvlytodkemdeeox).
 * Generated 2026-04-07 — covers tables added through migration 20260407000000.
 *
 * Usage:
 *   import type { Database } from './database.types';
 *   const client = createClient<Database>(url, key);
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      // ----------------------------------------------------------------
      // subscriptions
      // ----------------------------------------------------------------
      subscriptions: {
        Row: {
          id:                     string;       // uuid
          user_id:                string;       // uuid → auth.users
          stripe_customer_id:     string | null;
          stripe_subscription_id: string | null;
          status:                 SubscriptionStatus;
          price_id:               string | null;
          current_period_end:     string | null; // timestamptz ISO string
          created_at:             string;
          updated_at:             string;
        };
        Insert: {
          id?:                    string;
          user_id:                string;
          stripe_customer_id?:    string | null;
          stripe_subscription_id?: string | null;
          status:                 SubscriptionStatus;
          price_id?:              string | null;
          current_period_end?:    string | null;
          created_at?:            string;
          updated_at?:            string;
        };
        Update: {
          id?:                    string;
          user_id?:               string;
          stripe_customer_id?:    string | null;
          stripe_subscription_id?: string | null;
          status?:                SubscriptionStatus;
          price_id?:              string | null;
          current_period_end?:    string | null;
          updated_at?:            string;
        };
      };

      // ----------------------------------------------------------------
      // entitlements
      // ----------------------------------------------------------------
      entitlements: {
        Row: {
          user_id:    string;       // uuid pk → auth.users
          tier:       EntitlementTier;
          features:   Json;
          updated_at: string;
        };
        Insert: {
          user_id:    string;
          tier?:      EntitlementTier;
          features?:  Json;
          updated_at?: string;
        };
        Update: {
          tier?:      EntitlementTier;
          features?:  Json;
          updated_at?: string;
        };
      };

      // ----------------------------------------------------------------
      // webhook_events
      // ----------------------------------------------------------------
      webhook_events: {
        Row: {
          id:              string;   // uuid
          stripe_event_id: string | null;
          event_type:      string;
          payload:         Json;
          processed_at:    string;
        };
        Insert: {
          id?:             string;
          stripe_event_id?: string | null;
          event_type:      string;
          payload?:        Json;
          processed_at?:   string;
        };
        Update: {
          event_type?:     string;
          payload?:        Json;
        };
      };

      // ----------------------------------------------------------------
      // attorney_leads  (existing)
      // ----------------------------------------------------------------
      attorney_leads: {
        Row: {
          id:                   string;
          created_at:           string;
          first_name:           string;
          last_name:            string;
          phone_e164:           string;
          email:                string | null;
          date_of_accident:     string | null;
          employer_name:        string | null;
          accident_description: string | null;
          injuries:             string | null;
          preferred_contact:    string | null;
          geo_lat:              number | null;
          geo_lng:              number | null;
          geo_zip:              string | null;
          geo_consent:          boolean;
          tcpa_consent:         boolean;
          disclaimer_ack:       boolean;
          utm:                  Json | null;
          status:               string;
        };
        Insert: Omit<Database['public']['Tables']['attorney_leads']['Row'], 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['attorney_leads']['Row']>;
      };

      // ----------------------------------------------------------------
      // attorney_accounts  (existing)
      // ----------------------------------------------------------------
      attorney_accounts: {
        Row: {
          id:                     string;
          created_at:             string;
          user_id:                string;
          firm_name:              string;
          attorney_name:          string;
          bar_number:             string | null;
          office_address:         string | null;
          office_lat:             number | null;
          office_lng:             number | null;
          phone_e164:             string | null;
          public_email:           string | null;
          website:                string | null;
          practice_areas:         string[] | null;
          languages:              string[] | null;
          headshot_url:           string | null;
          bio:                    string | null;
          stripe_customer_id:     string | null;
          stripe_subscription_id: string | null;
          status:                 string;
        };
        Insert: Omit<Database['public']['Tables']['attorney_accounts']['Row'], 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['attorney_accounts']['Row']>;
      };

      // ----------------------------------------------------------------
      // aww_shares  (existing)
      // ----------------------------------------------------------------
      aww_shares: {
        Row: {
          id:         string;
          token:      string;
          payload:    Json;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          id?:        string;
          token:      string;
          payload:    Json;
          created_at?: string;
          expires_at:  string;
        };
        Update: Partial<Database['public']['Tables']['aww_shares']['Row']>;
      };
    };

    Views: {
      participating_attorneys: {
        Row: {
          id:             string;
          firm_name:      string;
          attorney_name:  string;
          office_address: string | null;
          office_lat:     number | null;
          office_lng:     number | null;
          phone_e164:     string | null;
          public_email:   string | null;
          website:        string | null;
          practice_areas: string[] | null;
          languages:      string[] | null;
          headshot_url:   string | null;
          bio:            string | null;
        };
      };
    };

    Functions: Record<string, never>;

    Enums: {
      subscription_status: SubscriptionStatus;
      entitlement_tier:    EntitlementTier;
    };
  };
}

// ----------------------------------------------------------------
// Shared enums
// ----------------------------------------------------------------

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete';

export type EntitlementTier = 'free' | 'pro';

// ----------------------------------------------------------------
// Convenience row aliases
// ----------------------------------------------------------------

export type SubscriptionRow  = Database['public']['Tables']['subscriptions']['Row'];
export type EntitlementRow   = Database['public']['Tables']['entitlements']['Row'];
export type WebhookEventRow  = Database['public']['Tables']['webhook_events']['Row'];
export type AttorneyLeadRow  = Database['public']['Tables']['attorney_leads']['Row'];
export type AttorneyAccountRow = Database['public']['Tables']['attorney_accounts']['Row'];
