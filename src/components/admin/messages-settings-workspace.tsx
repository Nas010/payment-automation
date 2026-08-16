"use client";

import type { ReactNode } from "react";
import { BellRingIcon, CreditCardIcon, MessageCircleReplyIcon, HandshakeIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Props = {
  welcome: ReactNode;
  automaticReplies: ReactNode;
  paymentMessages: ReactNode;
  reminders: ReactNode;
};

export function MessagesSettingsWorkspace({ welcome, automaticReplies, paymentMessages, reminders }: Props) {
  return <section className="flex flex-col gap-6">
    <div className="flex flex-col gap-1">
      <h2 className="text-xl font-semibold">Messages</h2>
    </div>
    <Tabs defaultValue="welcome" className="gap-6">
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="welcome" className="flex-none px-3">
          <HandshakeIcon data-icon="inline-start" />
          <span>Welcome message</span>
        </TabsTrigger>
        <TabsTrigger value="replies" className="flex-none px-3">
          <MessageCircleReplyIcon data-icon="inline-start" />
          <span>Automatic replies</span>
        </TabsTrigger>
        <TabsTrigger value="payments" className="flex-none px-3">
          <CreditCardIcon data-icon="inline-start" />
          <span>Payment messages</span>
        </TabsTrigger>
        <TabsTrigger value="reminders" className="flex-none px-3">
          <BellRingIcon data-icon="inline-start" />
          <span>Installment reminders</span>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="welcome" className="min-w-0">{welcome}</TabsContent>
      <TabsContent value="replies" className="min-w-0">{automaticReplies}</TabsContent>
      <TabsContent value="payments" className="min-w-0">{paymentMessages}</TabsContent>
      <TabsContent value="reminders" className="min-w-0">{reminders}</TabsContent>
    </Tabs>
  </section>;
}
