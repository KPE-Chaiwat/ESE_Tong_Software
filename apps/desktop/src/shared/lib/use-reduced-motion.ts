import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function read(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(QUERY).matches
    : false;
}

/** True when the user asked for reduced motion: spinners become static icons (DES-001 7). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(read);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(QUERY);
    const onChange = () => setReduced(media.matches);
    onChange();
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  return reduced;
}
