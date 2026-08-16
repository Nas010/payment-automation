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
    <Tabs defaultValue="welcome" className="gap-6 lg:flex-row">
      <TabsList className="h-auto w-full justify-start overflow-x-auto lg:w-56 lg:shrink-0 lg:flex-col lg:items-stretch">
        <TabsTrigger value="welcome" className="h-auto min-h-14 flex-none justify-start whitespace-normal px-3 py-2 text-left lg:w-full">
          <HandshakeIcon data-icon="inline-start" />
          <span className="flex flex-col items-start"><span>Welcome message</span><span className="text-xs font-normal text-muted-foreground">New client connections</span></span>
        </TabsTrigger>
        <TabsTrigger value="replies" className="h-auto min-h-14 flex-none justify-start whitespace-normal px-3 py-2 text-left lg:w-full">
          <MessageCircleReplyIcon data-icon="inline-start" />
          <span className="flex flex-col items-start"><span>Automatic replies</span><span className="text-xs font-normal text-muted-foreground">Slip and connection responses</span></span>
        </TabsTrigger>
        <TabsTrigger value="payments" className="h-auto min-h-14 flex-none justify-start whitespace-normal px-3 py-2 text-left lg:w-full">
          <CreditCardIcon data-icon="inline-start" />
          <span className="flex flex-col items-start"><span>Payment messages</span><span className="text-xs font-normal text-muted-foreground">Due-payment notices</span></span>
        </TabsTrigger>
        <TabsTrigger value="reminders" className="h-auto min-h-14 flex-none justify-start whitespace-normal px-3 py-2 text-left lg:w-full">
          <BellRingIcon data-icon="inline-start" />
          <span className="flex flex-col items-start"><span>Installment reminders</span><span className="text-xs font-normal text-muted-foreground">Later payment alerts</span></span>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="welcome" className="min-w-0">{welcome}</TabsContent>
      <TabsContent value="replies" className="min-w-0">{automaticReplies}</TabsContent>
      <TabsContent value="payments" className="min-w-0">{paymentMessages}</TabsContent>
      <TabsContent value="reminders" className="min-w-0">{reminders}</TabsContent>
    </Tabs>
  </section>;
}
