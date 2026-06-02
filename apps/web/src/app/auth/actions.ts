"use server";

import { createServerSupabaseClient } from "../../lib/supabase/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function redirectWithError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function safeRedirectPath(path: string, fallback: string) {
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return fallback;
  }

  return path;
}

export async function signInAction(formData: FormData) {
  const email = formString(formData, "email");
  const password = formString(formData, "password");

  if (!email || !password) {
    redirectWithError("/sign-in", "Email and password are required.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirectWithError("/sign-in", error.message);
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signUpAction(formData: FormData) {
  const email = formString(formData, "email");
  const password = formString(formData, "password");
  const name = formString(formData, "name");
  const failurePath = safeRedirectPath(
    formString(formData, "failurePath"),
    "/sign-in",
  );

  if (!email || !password) {
    redirectWithError(failurePath, "Email and password are required.");
  }

  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
      },
      emailRedirectTo: origin ? `${origin}/auth/callback` : undefined,
    },
  });

  if (error) {
    redirectWithError(failurePath, error.message);
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOutAction() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/sign-in");
}
