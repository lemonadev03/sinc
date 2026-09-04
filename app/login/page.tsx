"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { loginAction, type ActionState } from "../actions";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { Center } from "@astryxdesign/core/Center";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { AstryxLink } from "@/components/AstryxLink";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(loginAction, {});
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <Center maxWidth={400} width="100%">
      <VStack gap={5} width="100%">
        <Heading level={1}>Log in</Heading>
        <Card>
          <form action={formAction}>
            <VStack gap={4}>
              <TextInput label="Email" type="email" value={email} onChange={setEmail} htmlName="email" isRequired />
              <TextInput label="Password" type="password" value={password} onChange={setPassword} htmlName="password" isRequired />
              {state.error && <Text>{state.error}</Text>}
              <Button label={pending ? "Signing in" : "Log in"} variant="primary" type="submit" isLoading={pending} width="100%" />
              <Text color="secondary">
                No account yet? <AstryxLink href="/signup">Sign up</AstryxLink>
              </Text>
            </VStack>
          </form>
        </Card>
      </VStack>
    </Center>
  );
}
