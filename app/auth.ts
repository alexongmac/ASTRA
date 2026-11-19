import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        username: { label: "Operator name" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const username = credentials?.username;
        const password = credentials?.password;
        if (typeof username !== "string" || typeof password !== "string") return null;

        const operator = await prisma.operator.findUnique({ where: { username } });
        if (!operator) return null;
        if (!(await bcrypt.compare(password, operator.passwordHash))) return null;

        return { id: String(operator.id), name: operator.displayName };
      },
    }),
  ],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) token.operatorId = Number(user.id);
      return token;
    },
    session: ({ session, token }) => {
      if (token.operatorId) session.user.operatorId = token.operatorId as number;
      return session;
    },
  },
});
