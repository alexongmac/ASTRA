"use client";

import { useId } from "react";
import { InlineScript } from "./inline-script";

// Same look as before (e.g. "11/24/26, 10:05:11 AM"), but in the viewer's own
// time zone. The server renders in its own zone (UTC in the cluster), so an
// inline script corrects the text before first paint on a full page load, and
// the browser formats it directly on client-side refreshes. Without this the
// page showed UTC for everyone.
const FORMAT: Intl.DateTimeFormatOptions = {
  dateStyle: "short",
  timeStyle: "medium",
};

export function LocalTime({ iso }: { iso: string }) {
  const id = useId();

  return (
    <>
      <time id={id} dateTime={iso} suppressHydrationWarning>
        {new Date(iso).toLocaleString("en-US", FORMAT)}
      </time>
      <InlineScript
        html={`{var n=document.getElementById(${JSON.stringify(id)});if(n)n.textContent=new Date(${JSON.stringify(iso)}).toLocaleString("en-US",${JSON.stringify(FORMAT)})}`}
      />
    </>
  );
}
