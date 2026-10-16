import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges conditional class names and resolves Tailwind conflicts (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
