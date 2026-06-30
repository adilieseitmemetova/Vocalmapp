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
    meaning: "Идет на повышение",
    color: "#1aae39",
    icon: "up"
  },
  {
    id: "down",
    label: "Down",
    meaning: "Идет на понижение",
    color: "#0075de",
    icon: "down"
  },
  {
    id: "vib",
    label: "Vib",
    meaning: "Вибрато",
    color: "#8f4fd7",
    icon: "wave"
  },
  {
    id: "hold",
    label: "Hold",
    meaning: "Тянуть звук",
    color: "#c69214",
    icon: "line"
  },
  {
    id: "breath",
    label: "Breath",
    meaning: "Взять дыхание",
    color: "#2a9d99",
    icon: "breath"
  },
  {
    id: "accent",
    label: "Accent",
    meaning: "Акцент",
    color: "#dc2f2f",
    icon: "accent"
  },
  {
    id: "soft",
    label: "Soft",
    meaning: "Мягко",
    color: "#ff64c8",
    icon: "soft"
  },
  {
    id: "strong",
    label: "Strong",
    meaning: "Сильнее",
    color: "#dd5b00",
    icon: "strong"
  },
  {
    id: "slide-up",
    label: "Slide ↑",
    meaning: "Скольжение вверх",
    color: "#178a2f",
    icon: "up"
  },
  {
    id: "slide-down",
    label: "Slide ↓",
    meaning: "Скольжение вниз",
    color: "#1d6fbd",
    icon: "down"
  },
  {
    id: "legato",
    label: "Legato",
    meaning: "Соединить мягко, без разрыва",
    color: "#6b58c8",
    icon: "wave"
  },
  {
    id: "pause",
    label: "Pause",
    meaning: "Пауза или не спешить",
    color: "#615d59",
    icon: "pause"
  },
  {
    id: "cut",
    label: "Cut",
    meaning: "Коротко снять звук",
    color: "#9b2f2f",
    icon: "cut"
  },
  {
    id: "run",
    label: "Run",
    meaning: "Мелизм или вокальный пробег",
    color: "#007a7a",
    icon: "repeat"
  },
  {
    id: "mix",
    label: "Mix",
    meaning: "Микст",
    color: "#7a48aa",
    icon: "spark"
  },
  {
    id: "head",
    label: "Head",
    meaning: "Головной голос",
    color: "#4a85d8",
    icon: "volume"
  },
  {
    id: "chest",
    label: "Chest",
    meaning: "Грудной голос",
    color: "#8a4b24",
    icon: "strong"
  },
  {
    id: "falsetto",
    label: "Falsetto",
    meaning: "Фальцет",
    color: "#c45aa0",
    icon: "soft"
  },
  {
    id: "twang",
    label: "Twang",
    meaning: "Яркий twang-оттенок",
    color: "#b76a00",
    icon: "spark"
  },
  {
    id: "cry",
    label: "Cry",
    meaning: "Плачущий оттенок",
    color: "#5b70c8",
    icon: "wave"
  },
  {
    id: "mute",
    label: "Mute",
    meaning: "Тише или убрать лишний звук",
    color: "#6d6a65",
    icon: "mute"
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

export const MARKER_ICON_OPTIONS: Array<{ value: MarkerIconName; label: string }> = [
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
  { value: "wave", label: "Wave" },
  { value: "line", label: "Line" },
  { value: "breath", label: "Breath" },
  { value: "accent", label: "Dot" },
  { value: "soft", label: "Circle" },
  { value: "strong", label: "Strong" },
  { value: "pause", label: "Pause" },
  { value: "cut", label: "Cut" },
  { value: "repeat", label: "Run" },
  { value: "spark", label: "Spark" },
  { value: "volume", label: "Voice" },
  { value: "mute", label: "Mute" }
];
