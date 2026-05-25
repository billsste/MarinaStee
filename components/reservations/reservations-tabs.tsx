"use client";

import * as React from "react";
import { CalendarDays, Clock, ListTodo, Sun } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarView } from "./calendar-view";
import { TodayView } from "./today-view";
import { ReservationsTable } from "./reservations-table";
import { WaitlistView } from "./waitlist-view";

/*
 * Top-level Reservations tabs: Calendar (default) / Today / List.
 * The calendar is the new primary lens — most marina staff want to "see
 * what the week / month looks like" before they drill into a single day.
 */
export function ReservationsTabs() {
  return (
    <Tabs defaultValue="calendar" className="w-full">
      <TabsList>
        <TabsTrigger value="calendar">
          <CalendarDays className="size-3.5" />
          Calendar
        </TabsTrigger>
        <TabsTrigger value="today">
          <Sun className="size-3.5" />
          Today
        </TabsTrigger>
        <TabsTrigger value="list">
          <ListTodo className="size-3.5" />
          List
        </TabsTrigger>
        <TabsTrigger value="waitlist">
          <Clock className="size-3.5" />
          Waitlist
        </TabsTrigger>
      </TabsList>

      <TabsContent value="calendar">
        <CalendarView />
      </TabsContent>
      <TabsContent value="today">
        <TodayView />
      </TabsContent>
      <TabsContent value="list">
        <ReservationsTable />
      </TabsContent>
      <TabsContent value="waitlist">
        <WaitlistView />
      </TabsContent>
    </Tabs>
  );
}
