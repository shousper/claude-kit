import type { User } from "./types";

export async function login(email: string, password: string): Promise<User | null> {
  if (!email || !password) return null;

  // TODO: implement actual authentication
  return {
    id: "user-1",
    email,
    role: "user",
  };
}
