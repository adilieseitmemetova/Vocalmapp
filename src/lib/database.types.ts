export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      annotations: {
        Row: {
          created_at: string;
          id: string;
          line_index: number;
          marker_id: string;
          note: string | null;
          target_type: Database["public"]["Enums"]["annotation_target_type"];
          updated_at: string;
          user_id: string;
          user_song_id: string;
          word_index: number | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          line_index: number;
          marker_id: string;
          note?: string | null;
          target_type: Database["public"]["Enums"]["annotation_target_type"];
          updated_at?: string;
          user_id: string;
          user_song_id: string;
          word_index?: number | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          line_index?: number;
          marker_id?: string;
          note?: string | null;
          target_type?: Database["public"]["Enums"]["annotation_target_type"];
          updated_at?: string;
          user_id?: string;
          user_song_id?: string;
          word_index?: number | null;
        };
        Relationships: [];
      };
      audio_references: {
        Row: {
          created_at: string;
          duration_ms: number | null;
          id: string;
          label: string;
          line_index: number | null;
          mime_type: string;
          size_bytes: number | null;
          storage_path: string;
          target_type: Database["public"]["Enums"]["audio_target_type"];
          updated_at: string;
          user_id: string;
          user_song_id: string;
          word_index: number | null;
        };
        Insert: {
          created_at?: string;
          duration_ms?: number | null;
          id?: string;
          label?: string;
          line_index?: number | null;
          mime_type: string;
          size_bytes?: number | null;
          storage_path: string;
          target_type: Database["public"]["Enums"]["audio_target_type"];
          updated_at?: string;
          user_id: string;
          user_song_id: string;
          word_index?: number | null;
        };
        Update: {
          created_at?: string;
          duration_ms?: number | null;
          id?: string;
          label?: string;
          line_index?: number | null;
          mime_type?: string;
          size_bytes?: number | null;
          storage_path?: string;
          target_type?: Database["public"]["Enums"]["audio_target_type"];
          updated_at?: string;
          user_id?: string;
          user_song_id?: string;
          word_index?: number | null;
        };
        Relationships: [];
      };
      lyrics_documents: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          line_word_counts: Json;
          lyrics_hash: string;
          lyrics_text: string;
          provider: string;
          provider_lyrics_id: string | null;
          tokenizer_version: string;
          track_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string;
          id?: string;
          line_word_counts?: Json;
          lyrics_hash: string;
          lyrics_text: string;
          provider?: string;
          provider_lyrics_id?: string | null;
          tokenizer_version?: string;
          track_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          line_word_counts?: Json;
          lyrics_hash?: string;
          lyrics_text?: string;
          provider?: string;
          provider_lyrics_id?: string | null;
          tokenizer_version?: string;
          track_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      lyric_timestamps: {
        Row: {
          created_at: string;
          id: string;
          line_index: number;
          timestamp_ms: number;
          updated_at: string;
          user_id: string;
          user_song_id: string;
          word_index: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          line_index: number;
          timestamp_ms: number;
          updated_at?: string;
          user_id: string;
          user_song_id: string;
          word_index: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          line_index?: number;
          timestamp_ms?: number;
          updated_at?: string;
          user_id?: string;
          user_song_id?: string;
          word_index?: number;
        };
        Relationships: [];
      };
      markers: {
        Row: {
          code: string | null;
          color: string;
          created_at: string;
          icon: string;
          id: string;
          is_system: boolean;
          label: string;
          meaning: string;
          sort_order: number;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          code?: string | null;
          color: string;
          created_at?: string;
          icon: string;
          id?: string;
          is_system?: boolean;
          label: string;
          meaning: string;
          sort_order?: number;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          code?: string | null;
          color?: string;
          created_at?: string;
          icon?: string;
          id?: string;
          is_system?: boolean;
          label?: string;
          meaning?: string;
          sort_order?: number;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          email: string | null;
          id: string;
          onboarding_completed: boolean;
          updated_at: string;
          vocal_goal: string | null;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id: string;
          onboarding_completed?: boolean;
          updated_at?: string;
          vocal_goal?: string | null;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id?: string;
          onboarding_completed?: boolean;
          updated_at?: string;
          vocal_goal?: string | null;
        };
        Relationships: [];
      };
      target_notes: {
        Row: {
          created_at: string;
          id: string;
          line_index: number;
          target_type: Database["public"]["Enums"]["note_target_type"];
          text: string;
          updated_at: string;
          user_id: string;
          user_song_id: string;
          word_index: number | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          line_index: number;
          target_type: Database["public"]["Enums"]["note_target_type"];
          text: string;
          updated_at?: string;
          user_id: string;
          user_song_id: string;
          word_index?: number | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          line_index?: number;
          target_type?: Database["public"]["Enums"]["note_target_type"];
          text?: string;
          updated_at?: string;
          user_id?: string;
          user_song_id?: string;
          word_index?: number | null;
        };
        Relationships: [];
      };
      tracks: {
        Row: {
          artist: string | null;
          channel_title: string | null;
          created_at: string;
          created_by: string;
          duration_ms: number | null;
          id: string;
          original_search_query: string | null;
          selected_version_type: string | null;
          source: string;
          source_track_id: string | null;
          thumbnail_url: string | null;
          title: string;
          updated_at: string;
          video_title: string | null;
          youtube_video_id: string | null;
        };
        Insert: {
          artist?: string | null;
          channel_title?: string | null;
          created_at?: string;
          created_by?: string;
          duration_ms?: number | null;
          id?: string;
          original_search_query?: string | null;
          selected_version_type?: string | null;
          source?: string;
          source_track_id?: string | null;
          thumbnail_url?: string | null;
          title: string;
          updated_at?: string;
          video_title?: string | null;
          youtube_video_id?: string | null;
        };
        Update: {
          artist?: string | null;
          channel_title?: string | null;
          created_at?: string;
          created_by?: string;
          duration_ms?: number | null;
          id?: string;
          original_search_query?: string | null;
          selected_version_type?: string | null;
          source?: string;
          source_track_id?: string | null;
          thumbnail_url?: string | null;
          title?: string;
          updated_at?: string;
          video_title?: string | null;
          youtube_video_id?: string | null;
        };
        Relationships: [];
      };
      user_songs: {
        Row: {
          artist: string | null;
          channel_title: string | null;
          created_at: string;
          duration_ms: number | null;
          id: string;
          lyrics_document_id: string;
          original_search_query: string | null;
          selected_version_type: string | null;
          source: string;
          thumbnail_url: string | null;
          title: string;
          track_id: string;
          updated_at: string;
          user_id: string;
          video_title: string | null;
          youtube_video_id: string | null;
        };
        Insert: {
          artist?: string | null;
          channel_title?: string | null;
          created_at?: string;
          duration_ms?: number | null;
          id?: string;
          lyrics_document_id: string;
          original_search_query?: string | null;
          selected_version_type?: string | null;
          source?: string;
          thumbnail_url?: string | null;
          title: string;
          track_id: string;
          updated_at?: string;
          user_id: string;
          video_title?: string | null;
          youtube_video_id?: string | null;
        };
        Update: {
          artist?: string | null;
          channel_title?: string | null;
          created_at?: string;
          duration_ms?: number | null;
          id?: string;
          lyrics_document_id?: string;
          original_search_query?: string | null;
          selected_version_type?: string | null;
          source?: string;
          thumbnail_url?: string | null;
          title?: string;
          track_id?: string;
          updated_at?: string;
          user_id?: string;
          video_title?: string | null;
          youtube_video_id?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      annotation_target_type: "line" | "word";
      audio_target_type: "song" | "line" | "word";
      note_target_type: "line" | "word";
    };
    CompositeTypes: Record<string, never>;
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;
type DefaultSchema = DatabaseWithoutInternals["public"];

export type Tables<TableName extends keyof DefaultSchema["Tables"]> = DefaultSchema["Tables"][TableName]["Row"];
export type TablesInsert<TableName extends keyof DefaultSchema["Tables"]> = DefaultSchema["Tables"][TableName]["Insert"];
export type TablesUpdate<TableName extends keyof DefaultSchema["Tables"]> = DefaultSchema["Tables"][TableName]["Update"];
export type Enums<EnumName extends keyof DefaultSchema["Enums"]> = DefaultSchema["Enums"][EnumName];

export const Constants = {
  public: {
    Enums: {
      annotation_target_type: ["line", "word"],
      audio_target_type: ["song", "line", "word"],
      note_target_type: ["line", "word"]
    }
  }
} as const;
