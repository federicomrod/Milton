// components/dashboard/reports/MonthYearPicker.tsx
"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface MonthYearPickerProps {
  value: string; // Format: "January 2024"
  onChange: (value: string) => void;
  minYear?: number; // Default: 2024
  maxYear?: number; // Default: current year
}

export function MonthYearPicker({
  value,
  onChange,
  minYear = 2024,
  maxYear = new Date().getFullYear(),
}: MonthYearPickerProps) {
  // Parse current value
  const [monthName, yearStr] = value.split(" ");
  const currentMonth = MONTHS.indexOf(monthName || "January");
  const currentYear = parseInt(yearStr || new Date().getFullYear().toString());

  // Generate year options
  const years = Array.from(
    { length: maxYear - minYear + 1 },
    (_, i) => maxYear - i
  );

  const handleMonthChange = (monthIndex: string) => {
    const newMonth = MONTHS[parseInt(monthIndex)];
    onChange(`${newMonth} ${currentYear}`);
  };

  const handleYearChange = (year: string) => {
    onChange(`${MONTHS[currentMonth]} ${year}`);
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="month">Month</Label>
        <Select
          value={currentMonth >= 0 ? currentMonth.toString() : "0"}
          onValueChange={handleMonthChange}
        >
          <SelectTrigger id="month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((month, index) => (
              <SelectItem key={month} value={index.toString()}>
                {month}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="year">Year</Label>
        <Select value={currentYear.toString()} onValueChange={handleYearChange}>
          <SelectTrigger id="year">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((year) => (
              <SelectItem key={year} value={year.toString()}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
