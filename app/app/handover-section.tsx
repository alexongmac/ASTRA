// A titled block on the handover page, in the same slate card style as the tables.
export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="mt-4 rounded-lg border border-slate-700 bg-slate-800 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-medium text-blue-400">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
