import {
  ArrowDown,
  ArrowUp,
  Circle,
  CircleDot,
  Dot,
  Minus,
  MoveHorizontal,
  Pause,
  Repeat2,
  Slash,
  Sparkles,
  Volume2,
  VolumeX,
  Wind
} from "lucide-react";
import type { ComponentType } from "react";
import type { Marker, MarkerIconName } from "./types";

export const DEFAULT_MARKERS: Marker[] = [
  {
    id: "up",
    label: "Up",
    meaning: "Pitch rises",
    color: "#1aae39",
    icon: "up",
    isSystem: true
  },
  {
    id: "down",
    label: "Down",
    meaning: "Pitch falls",
    color: "#0075de",
    icon: "down",
    isSystem: true
  },
  {
    id: "vib",
    label: "Vib",
    meaning: "Vibrato",
    color: "#8f4fd7",
    icon: "wave",
    isSystem: true
  },
  {
    id: "hold",
    label: "Hold",
    meaning: "Sustain the sound",
    color: "#c69214",
    icon: "line",
    isSystem: true
  },
  {
    id: "breath",
    label: "Breath",
    meaning: "Take a breath",
    color: "#2a9d99",
    icon: "breath",
    isSystem: true
  },
  {
    id: "accent",
    label: "Accent",
    meaning: "Emphasize this sound",
    color: "#dc2f2f",
    icon: "accent",
    isSystem: true
  },
  {
    id: "soft",
    label: "Soft",
    meaning: "Sing gently",
    color: "#ff64c8",
    icon: "soft",
    isSystem: true
  },
  {
    id: "strong",
    label: "Strong",
    meaning: "Add strength",
    color: "#dd5b00",
    icon: "strong",
    isSystem: true
  },
  {
    id: "slide-up",
    label: "Slide up",
    meaning: "Slide upward",
    color: "#178a2f",
    icon: "up",
    isSystem: true
  },
  {
    id: "slide-down",
    label: "Slide down",
    meaning: "Slide downward",
    color: "#1d6fbd",
    icon: "down",
    isSystem: true
  },
  {
    id: "legato",
    label: "Legato",
    meaning: "Connect smoothly without a break",
    color: "#6b58c8",
    icon: "wave",
    isSystem: true
  },
  {
    id: "pause",
    label: "Pause",
    meaning: "Pause or slow down",
    color: "#615d59",
    icon: "pause",
    isSystem: true
  },
  {
    id: "cut",
    label: "Cut",
    meaning: "Release the sound quickly",
    color: "#9b2f2f",
    icon: "cut",
    isSystem: true
  },
  {
    id: "run",
    label: "Run",
    meaning: "Melisma or vocal run",
    color: "#007a7a",
    icon: "repeat",
    isSystem: true
  },
  {
    id: "mix",
    label: "Mix",
    meaning: "Mixed voice",
    color: "#7a48aa",
    icon: "spark",
    isSystem: true
  },
  {
    id: "head",
    label: "Head",
    meaning: "Head voice",
    color: "#4a85d8",
    icon: "volume",
    isSystem: true
  },
  {
    id: "chest",
    label: "Chest",
    meaning: "Chest voice",
    color: "#8a4b24",
    icon: "strong",
    isSystem: true
  },
  {
    id: "falsetto",
    label: "Falsetto",
    meaning: "Falsetto",
    color: "#c45aa0",
    icon: "soft",
    isSystem: true
  },
  {
    id: "twang",
    label: "Twang",
    meaning: "Bright twang tone",
    color: "#b76a00",
    icon: "spark",
    isSystem: true
  },
  {
    id: "cry",
    label: "Cry",
    meaning: "Crying tone",
    color: "#5b70c8",
    icon: "wave",
    isSystem: true
  },
  {
    id: "mute",
    label: "Mute",
    meaning: "Sing quieter or remove extra sound",
    color: "#6d6a65",
    icon: "mute",
    isSystem: true
  }
];

export const markerIcons: Record<MarkerIconName, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  up: ArrowUp,
  down: ArrowDown,
  wave: MoveHorizontal,
  line: Minus,
  breath: Wind,
  accent: Dot,
  soft: Circle,
  strong: CircleDot,
  pause: Pause,
  cut: Slash,
  repeat: Repeat2,
  spark: Sparkles,
  volume: Volume2,
  mute: VolumeX
};

export const MARKER_ICON_OPTIONS: Array<{ value: MarkerIconName }> = [
  { value: "up" },
  { value: "down" },
  { value: "wave" },
  { value: "line" },
  { value: "breath" },
  { value: "accent" },
  { value: "soft" },
  { value: "strong" },
  { value: "pause" },
  { value: "cut" },
  { value: "repeat" },
  { value: "spark" },
  { value: "volume" },
  { value: "mute" }
];
