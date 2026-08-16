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
      <p className="text-sm text-muted-foreground">Choose a message type, then edit its template.</p>
    </div>
    <Tabs defaultValue="welcome" className="gap-6">
      <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 2xl:grid-cols-4">
        <TabsTrigger value="welcome" className="h-auto min-h-12 justify-start whitespace-normal px-3 py-2 text-left">
          <HandshakeIcon data-icon="inline-start" />
          <span>Welcome message</span>
        </TabsTrigger>
        <TabsTrigger value="replies" className="h-auto min-h-12 justify-start whitespace-normal px-3 py-2 text-left">
          <MessageCircleReplyIcon data-icon="inline-start" />
          <span>Automatic replies</span>
        </TabsTrigger>
        <TabsTrigger value="payments" className="h-auto min-h-12 justify-start whitespace-normal px-3 py-2 text-left">
          <CreditCardIcon data-icon="inline-start" />
          <span>Payment messages</span>
        </TabsTrigger>
        <TabsTrigger value="reminders" className="h-auto min-h-12 justify-start whitespace-normal px-3 py-2 text-left">
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
