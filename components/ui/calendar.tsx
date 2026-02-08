"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface CalendarProps {
  value?: Date;
  onChange?: (date: Date) => void;
  fromDate?: Date;
  toDate?: Date;
  className?: string;
}

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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function Calendar({
  value,
  onChange,
  fromDate,
  toDate,
  className,
}: CalendarProps) {
  const [currentMonth, setCurrentMonth] = React.useState(
    value ? new Date(value.getFullYear(), value.getMonth(), 1) : new Date()
  );

  React.useEffect(() => {
    if (value) {
      setCurrentMonth(new Date(value.getFullYear(), value.getMonth(), 1));
    }
  }, [value]);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const daysInMonth = lastDayOfMonth.getDate();
  const startingDayOfWeek = firstDayOfMonth.getDay();

  const days: (Date | null)[] = [];

  // Add empty cells for days before the first day of the month
  for (let i = 0; i < startingDayOfWeek; i++) {
    days.push(null);
  }

  // Add all days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    days.push(new Date(year, month, day));
  }

  const goToPreviousMonth = () => {
    setCurrentMonth(new Date(year, month - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentMonth(new Date(year, month + 1, 1));
  };

  const handleMonthChange = (newMonth: string) => {
    setCurrentMonth(new Date(year, parseInt(newMonth), 1));
  };

  const handleYearChange = (newYear: string) => {
    setCurrentMonth(new Date(parseInt(newYear), month, 1));
  };

  // Generate year options (current year ± 10 years)
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from(
    { length: 21 },
    (_, i) => currentYear - 10 + i
  );

  const isDateSelected = (date: Date) => {
    if (!value) return false;
    return (
      date.getDate() === value.getDate() &&
      date.getMonth() === value.getMonth() &&
      date.getFullYear() === value.getFullYear()
    );
  };

  const isDateInRange = (date: Date) => {
    if (!fromDate || !toDate) return false;
    return date >= fromDate && date <= toDate;
  };

  const isDateDisabled = (date: Date) => {
    if (fromDate && toDate) {
      return date < fromDate || date > toDate;
    }
    return false;
  };

  const handleDateClick = (date: Date) => {
    if (isDateDisabled(date)) return;
    onChange?.(date);
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  return (
    <div className={cn("p-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 gap-1 sm:gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 hover:bg-accent shrink-0"
          onClick={goToPreviousMonth}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-1 sm:gap-1.5 justify-center flex-1 min-w-0">
          <Select value={month.toString()} onValueChange={handleMonthChange}>
            <SelectTrigger
              size="sm"
              className="h-8 border-0 shadow-none hover:bg-accent focus:ring-0 focus:ring-offset-0 w-[90px] sm:w-[110px] max-w-[90px] sm:max-w-[110px]"
            >
              <SelectValue>
                <span className="font-semibold text-xs sm:text-sm truncate">
                  {MONTHS[month]}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((monthName, index) => (
                <SelectItem key={index} value={index.toString()}>
                  {monthName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={year.toString()} onValueChange={handleYearChange}>
            <SelectTrigger
              size="sm"
              className="h-8 border-0 shadow-none hover:bg-accent focus:ring-0 focus:ring-offset-0 w-[80px] sm:w-[100px] min-w-[80px] sm:min-w-[100px] [&_[data-slot=select-value]]:pr-4 sm:[&_[data-slot=select-value]]:pr-6"
            >
              <SelectValue>
                <span className="font-semibold text-xs sm:text-sm">{year}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={y.toString()}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 hover:bg-accent shrink-0"
          onClick={goToNextMonth}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="text-center text-xs font-medium text-muted-foreground py-2"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((date, index) => {
          if (!date) {
            return <div key={`empty-${index}`} className="aspect-square" />;
          }

          const selected = isDateSelected(date);
          const inRange = isDateInRange(date);
          const disabled = isDateDisabled(date);
          const today = isToday(date);

          return (
            <Button
              key={date.toISOString()}
              variant="ghost"
              className={cn(
                "aspect-square h-9 w-9 p-0 font-normal text-sm rounded-md transition-colors",
                selected &&
                  "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground font-semibold",
                !selected &&
                  !disabled &&
                  !inRange &&
                  "hover:bg-accent hover:text-accent-foreground",
                inRange &&
                  !selected &&
                  "bg-accent/30 text-accent-foreground hover:bg-accent/50",
                disabled &&
                  "opacity-40 cursor-not-allowed hover:bg-transparent",
                today && !selected && "border-2 border-primary/50 font-semibold"
              )}
              onClick={() => handleDateClick(date)}
              disabled={disabled}
            >
              {date.getDate()}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
