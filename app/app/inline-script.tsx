// Runs a snippet synchronously while the browser parses the HTML, before first
// paint. type is text/javascript on the server (so it executes) and text/plain
// on the client (so React does not warn about rendering a <script>);
// suppressHydrationWarning covers that difference. See Next.js docs:
// "Preventing flash before hydration".
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
