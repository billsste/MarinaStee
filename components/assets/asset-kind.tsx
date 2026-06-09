"use client";

import * as React from "react";
import {
  Truck,
  ArrowUpFromLine,
  Droplet,
  Fuel,
  Flame,
  Wind,
  Anchor,
  Wrench,
  Zap,
  Boxes,
} from "lucide-react";
import type { MarinaAssetKind } from "@/lib/types";

/*
 * Asset kind → human label + Lucide icon.
 * Keep this small + dependency-free so it can be reused on the
 * dashboard back-office card without dragging in the full assets
 * module.
 */

const LABELS: Record<MarinaAssetKind, string> = {
  forklift: "Forklift",
  boat_lift: "Boat lift",
  hoist: "Hoist",
  pump_out_boat: "Pump-out boat",
  pump_out_station: "Pump-out station",
  courtesy_cart: "Courtesy cart",
  fuel_pump: "Fuel pump",
  fuel_tank: "Fuel tank",
  fire_system: "Fire system",
  compressor: "Compressor",
  generator: "Generator",
  office_equipment: "Office equipment",
  other: "Other",
};

const ICONS: Record<MarinaAssetKind, React.ComponentType<{ className?: string }>> = {
  forklift: Truck,
  boat_lift: ArrowUpFromLine,
  hoist: ArrowUpFromLine,
  pump_out_boat: Droplet,
  pump_out_station: Droplet,
  courtesy_cart: Truck,
  fuel_pump: Fuel,
  fuel_tank: Fuel,
  fire_system: Flame,
  compressor: Wind,
  generator: Zap,
  office_equipment: Boxes,
  other: Wrench,
};

export function assetKindLabel(kind: MarinaAssetKind): string {
  return LABELS[kind] ?? kind;
}

export function AssetKindIcon({
  kind,
  className,
}: {
  kind: MarinaAssetKind;
  className?: string;
}) {
  const Icon = ICONS[kind] ?? Anchor;
  return <Icon className={className} />;
}

export const KIND_OPTIONS = (Object.keys(LABELS) as MarinaAssetKind[]).map(
  (k) => ({ value: k, label: LABELS[k] })
);
