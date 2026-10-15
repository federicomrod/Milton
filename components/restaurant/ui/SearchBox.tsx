"use client";

import { Search } from "lucide-react";

/** The prominent search field of the Menú lists: icon, brand-blue border and focus ring. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <label
      className={
        "flex h-10 items-center gap-2 rounded-xl border-2 border-[#a9bcf0] bg-white px-3 text-[#1b40c8] focus-within:border-[#1b40c8] focus-within:ring-2 focus-within:ring-[#1b40c8]/20 " +
        className
      }
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[14px] text-[#151c2c] outline-none placeholder:text-[#7d8aa8]"
      />
    </label>
  );
}
