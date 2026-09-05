import { Resend } from "resend";

function required(name: "RESEND_API_KEY" | "AUTH_EMAIL_FROM") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to deliver email OTPs`);
  return value;
}

export async function sendEmailOtp(input: { email: string; otp: string; type: string }) {
  const resend = new Resend(required("RESEND_API_KEY"));
  const from = required("AUTH_EMAIL_FROM");
  const { error } = await resend.emails.send({
    from,
    to: [input.email],
    subject:
      input.type === "sign-in" ? "Your F-Trade sign-in code" : "Your F-Trade verification code",
    text: `Your verification code is ${input.otp}. It expires in 10 minutes.`,
  });
  if (error) throw new Error(`Resend OTP delivery failed: ${error.message}`);
}

export async function sendInvitationEmail(input: {
  email: string;
  inviteUrl: string;
  expiresAt: Date;
}) {
  const resend = new Resend(required("RESEND_API_KEY"));
  const { error } = await resend.emails.send({
    from: required("AUTH_EMAIL_FROM"),
    to: [input.email],
    subject: "You are invited to F-Trade Platform",
    text: `Use this invitation link to activate your account: ${input.inviteUrl}\n\nIt expires at ${input.expiresAt.toISOString()}. After activation, we will send a sign-in code to this email address.`,
  });
  if (error) throw new Error(`Resend invitation delivery failed: ${error.message}`);
}
