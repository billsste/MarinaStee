"use client";

import * as React from "react";
import { Plus, Pencil, Zap, Droplets, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import {
  usePicklistLabelMap,
  useRentalGroups,
  useRentalSpaces,
  upsertRentalGroup,
  deleteRentalGroup,
  upsertRentalSpace,
  deleteRentalSpace,
  nextRentalGroupId,
  nextRentalSpaceId,
} from "@/lib/client-store";
import { formatInches } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import type { RentalGroup, RentalSpace, SpaceStatus } from "@/lib/types";

/*
 * Physical slip inventory grouped by dock. Each group header is clickable
 * (opens the group edit dialog); each space row is clickable (opens the
 * space edit dialog). Add/remove for both is right inline.
 */

const STATUS_TONE: Record<SpaceStatus, "ok" | "warn" | "danger" | "neutral"> = {
  vacant: "ok",
  occupied: "danger",
  reserved: "warn",
  out_of_service: "neutral",
};

const GROUP_FIELDS: FieldSpec<RentalGroup>[] = [
  { key: "name", label: "Name", kind: "text", required: true },
  {
    key: "type",
    label: "Type",
    kind: "select",
    required: true,
    options: [
      { value: "slips", label: "Slips" },
      { value: "jet_ski", label: "Jet ski" },
      { value: "buoy", label: "Buoy" },
      { value: "dry_storage", label: "Dry storage" },
      { value: "mooring", label: "Mooring" },
      { value: "day_rental", label: "Day rental" },
    ],
  },
  { key: "check_in_time", label: "Check-in time", kind: "text", col: 2 },
  { key: "check_out_time", label: "Check-out time", kind: "text", col: 2 },
  { key: "notes", label: "Notes", kind: "textarea" },
];

const SPACE_FIELDS: FieldSpec<RentalSpace>[] = [
  { key: "number", label: "Number", kind: "text", required: true, col: 2 },
  {
    key: "occupancy_type",
    label: "Type",
    kind: "select",
    col: 2,
    // Managed in Settings → Customization. Super-user can add/rename.
    picklist: "occupancy_type",
  },
  { key: "length_inches", label: "Length (inches)", kind: "number", col: 2 },
  { key: "beam_inches", label: "Beam (inches)", kind: "number", col: 2 },
  { key: "draft_inches", label: "Draft (inches)", kind: "number", col: 2 },
  { key: "height_inches", label: "Height (inches)", kind: "number", col: 2 },
  { key: "has_power", label: "Power available", kind: "boolean" },
  { key: "has_water", label: "Water available", kind: "boolean" },
  { key: "has_pump_out", label: "Pump-out available", kind: "boolean" },
  {
    key: "status",
    label: "Status",
    kind: "select",
    options: [
      { value: "vacant", label: "Vacant" },
      { value: "occupied", label: "Occupied" },
      { value: "reserved", label: "Reserved" },
      { value: "out_of_service", label: "Out of service" },
    ],
  },
  { key: "active", label: "Active in inventory", kind: "boolean" },
];

export function InventoryView() {
  const groups = useRentalGroups();
  const spaces = useRentalSpaces();
  const occupancyTypeLabels = usePicklistLabelMap("occupancy_type");

  const [editGroup, setEditGroup] = React.useState<RentalGroup | undefined>();
  const [groupOpen, setGroupOpen] = React.useState(false);
  const [editSpace, setEditSpace] = React.useState<RentalSpace | undefined>();
  const [spaceOpen, setSpaceOpen] = React.useState(false);
  // When adding a new space we need to remember which group it belongs to
  // so the form can pre-fill group_id even though it's not user-editable.
  const [addingToGroupId, setAddingToGroupId] = React.useState<string | null>(null);

  function openAddGroup() {
    setEditGroup(undefined);
    setGroupOpen(true);
  }
  function openEditGroup(g: RentalGroup) {
    setEditGroup(g);
    setGroupOpen(true);
  }
  function openAddSpace(groupId: string) {
    setEditSpace(undefined);
    setAddingToGroupId(groupId);
    setSpaceOpen(true);
  }
  function openEditSpace(s: RentalSpace) {
    setEditSpace(s);
    setAddingToGroupId(null);
    setSpaceOpen(true);
  }

  function handleSaveGroup(values: RentalGroup) {
    const id = values.id || nextRentalGroupId();
    const groupSpaces = spaces.filter((s) => s.group_id === id);
    upsertRentalGroup({
      ...values,
      id,
      check_in_time: values.check_in_time || "12:00 PM",
      check_out_time: values.check_out_time || "11:00 AM",
      total_spaces: groupSpaces.length,
      occupied_spaces: groupSpaces.filter((s) => s.status === "occupied").length,
    });
  }

  function handleDeleteGroup(g: RentalGroup) {
    deleteRentalGroup(g.id);
  }

  function handleSaveSpace(values: RentalSpace) {
    const id = values.id || nextRentalSpaceId();
    const groupId = values.group_id || addingToGroupId;
    if (!groupId) return;
    upsertRentalSpace({
      ...values,
      id,
      group_id: groupId,
      number: values.number || "—",
      length_inches: Number(values.length_inches) || undefined,
      beam_inches: Number(values.beam_inches) || undefined,
      draft_inches: Number(values.draft_inches) || undefined,
      height_inches: Number(values.height_inches) || undefined,
      has_power: Boolean(values.has_power),
      has_water: Boolean(values.has_water),
      has_pump_out: Boolean(values.has_pump_out),
      active: values.active !== false,
      status: values.status || "vacant",
    });
  }

  function handleDeleteSpace(s: RentalSpace) {
    deleteRentalSpace(s.id);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-medium text-fg">Groups & slips</h2>
        <Button variant="secondary" size="sm" onClick={openAddGroup}>
          <Plus className="size-3.5" />
          New group
        </Button>
      </div>

      {groups.map((g) => {
        const groupSpaces = spaces.filter((s) => s.group_id === g.id);
        const occupiedCount = groupSpaces.filter((s) => s.status === "occupied").length;
        return (
          <div
            key={g.id}
            className="rounded-[12px] border border-hairline bg-surface-1"
          >
            {/* Group header — click anywhere to edit the group */}
            <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
              <button
                type="button"
                onClick={() => openEditGroup(g)}
                className="group flex flex-1 items-center justify-between gap-3 text-left"
              >
                <div>
                  <h3 className="flex items-center gap-1.5 text-[14px] font-medium text-fg">
                    {g.name}
                    <Pencil className="size-3 text-fg-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
                  </h3>
                  <p className="text-[11px] text-fg-tertiary">
                    {occupiedCount} of {groupSpaces.length} occupied · {g.type.replace("_", " ")}
                  </p>
                </div>
              </button>
              <Button variant="secondary" size="sm" onClick={() => openAddSpace(g.id)}>
                <Plus className="size-3.5" />
                Add slip
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-hairline text-[11px] uppercase tracking-wide text-fg-tertiary">
                    <Th>#</Th>
                    <Th>Type</Th>
                    <Th>Length</Th>
                    <Th>Beam</Th>
                    <Th>Power</Th>
                    <Th>Water</Th>
                    <Th>Pump-out</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {groupSpaces.length === 0 ? (
                    <tr>
                      <Td className="text-fg-tertiary" colSpan={8}>
                        No slips in this group yet. Click "Add slip" to create one.
                      </Td>
                    </tr>
                  ) : (
                    groupSpaces.map((s) => (
                      <tr
                        key={s.id}
                        onClick={() => openEditSpace(s)}
                        className="cursor-pointer border-b border-hairline last:border-b-0 transition-colors hover:bg-surface-2"
                      >
                        <Td className="font-mono text-[12px] font-medium text-fg">{s.number}</Td>
                        <Td className="text-fg-subtle">{occupancyTypeLabels.get(s.occupancy_type) ?? s.occupancy_type}</Td>
                        <Td>{s.length_inches ? formatInches(s.length_inches) : "—"}</Td>
                        <Td>{s.beam_inches ? formatInches(s.beam_inches) : "—"}</Td>
                        <Td>
                          <UtilityBadge on={s.has_power} icon={<Zap className="size-3" />} label="Power" />
                        </Td>
                        <Td>
                          <UtilityBadge on={s.has_water} icon={<Droplets className="size-3" />} label="Water" />
                        </Td>
                        <Td>
                          <UtilityBadge on={s.has_pump_out} icon={<Trash2 className="size-3" />} label="Pump-out" />
                        </Td>
                        <Td>
                          <Badge tone={STATUS_TONE[s.status]} size="sm">
                            {s.status.replace("_", " ")}
                          </Badge>
                        </Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {groups.length === 0 && (
        <div className="rounded-[12px] border border-dashed border-hairline bg-surface-1 px-4 py-10 text-center text-[13px] text-fg-subtle">
          No groups yet. Click "New group" to add your first dock, jet-ski rack, buoy field, or dry-storage area.
        </div>
      )}

      <RecordEditDialog<RentalGroup>
        open={groupOpen}
        onOpenChange={setGroupOpen}
        title={editGroup ? `Edit group — ${editGroup.name}` : "New group"}
        description="Groups are the top-level inventory units (docks, jet-ski racks, buoy fields, dry storage)."
        record={editGroup}
        fields={GROUP_FIELDS}
        onSave={handleSaveGroup}
        onDelete={editGroup ? handleDeleteGroup : undefined}
        entity="rental_group"
      />

      <RecordEditDialog<RentalSpace>
        open={spaceOpen}
        onOpenChange={setSpaceOpen}
        title={editSpace ? `Edit slip — ${editSpace.number}` : "New slip"}
        description="Slip = one rentable space inside a group. Power/Water/Pump-out flags drive utility billing."
        record={editSpace}
        fields={SPACE_FIELDS}
        onSave={handleSaveSpace}
        onDelete={editSpace ? handleDeleteSpace : undefined}
        entity="rental_space"
      />
    </div>
  );
}

function UtilityBadge({
  on,
  icon,
  label,
}: {
  on: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <span
      title={`${label}: ${on ? "available" : "not available"}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium",
        on ? "bg-status-info/10 text-status-info" : "bg-surface-2 text-fg-tertiary/70"
      )}
    >
      {icon}
      {on ? "yes" : "no"}
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2 text-left font-medium">{children}</th>;
}

function Td({
  children,
  className,
  colSpan,
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td className={"px-4 py-2 align-middle " + (className ?? "")} colSpan={colSpan}>
      {children}
    </td>
  );
}
