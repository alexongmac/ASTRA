import { auth } from "@/auth";
import { isEditable, roleOf } from "@/lib/shift-handover";
import { prisma } from "@/lib/prisma";

const fail = (error: string, status: number) => Response.json({ error }, { status });

export const parseBigId = (id: string): bigint | null => (/^\d+$/.test(id) ? BigInt(id) : null);

// Signed-in operator + the handover they are acting on. `needEditable` also
// requires the handover to be in an editable status, and the operator to be one
// of the people on it (or the one who started it).
export async function guardHandover(rawId: string, options: { needEditable: boolean }) {
  const session = await auth();
  const operatorId = session?.user?.operatorId;
  if (!operatorId) return { response: fail("Unauthorized", 401) } as const;

  const id = parseBigId(rawId);
  if (id === null) return { response: fail("Not found", 404) } as const;

  const handover = await prisma.shiftHandover.findUnique({ where: { id } });
  if (!handover) return { response: fail("Not found", 404) } as const;

  const role = roleOf(operatorId, handover);
  if (options.needEditable) {
    if (!isEditable(handover.status)) {
      return { response: fail(`A handover that is ${handover.status} cannot be changed`, 409) } as const;
    }
    if (!role.canEdit) {
      return { response: fail("Only the operators on this handover can change it", 403) } as const;
    }
  }
  return { id, handover, operatorId, role } as const;
}

export { fail };
