"use client";

import { useActionState, useState } from "react";
import { signupAction, type ActionState } from "../actions";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { AstryxLink } from "@/components/AstryxLink";

export default function SignupPage() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(signupAction, {});
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <VStack gap={5} className="mx-auto w-full max-w-sm">
        <Heading level={1}>Create an account</Heading>
        <Card>
          <form action={formAction}>
            <VStack gap={4}>
              <TextInput label="Email" type="email" value={email} onChange={setEmail} htmlName="email" isRequired />
              <TextInput
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                htmlName="password"
                placeholder="8+ characters"
                isRequired
              />
              {state.error && <Banner status="error" title="Could not create the account" description={state.error} />}
              <Button label={pending ? "Creating account" : "Sign up"} variant="primary" type="submit" isLoading={pending} width="100%" />
              <Text color="secondary">
                Have an account? <AstryxLink href="/login">Log in</AstryxLink>
              </Text>
            </VStack>
          </form>
        </Card>
    </VStack>
  );
}
