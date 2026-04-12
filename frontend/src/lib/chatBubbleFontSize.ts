import { ChatBubbleFontSize } from 'shared/types';

export const defaultChatBubbleFontSize = ChatBubbleFontSize.px14;

export const chatBubbleFontSizeOptions = [
  ChatBubbleFontSize.px12,
  ChatBubbleFontSize.px13,
  ChatBubbleFontSize.px14,
  ChatBubbleFontSize.px15,
  ChatBubbleFontSize.px16,
  ChatBubbleFontSize.px18,
] as const;

const chatBubbleFontSizeTextClassName: Record<ChatBubbleFontSize, string> = {
  [ChatBubbleFontSize.px12]: 'text-[12px] leading-5',
  [ChatBubbleFontSize.px13]: 'text-[13px] leading-5',
  [ChatBubbleFontSize.px14]: 'text-[14px] leading-6',
  [ChatBubbleFontSize.px15]: 'text-[15px] leading-6',
  [ChatBubbleFontSize.px16]: 'text-[16px] leading-7',
  [ChatBubbleFontSize.px18]: 'text-[18px] leading-7',
};

const chatBubbleFontSizeLabel: Record<ChatBubbleFontSize, string> = {
  [ChatBubbleFontSize.px12]: '12 px',
  [ChatBubbleFontSize.px13]: '13 px',
  [ChatBubbleFontSize.px14]: '14 px',
  [ChatBubbleFontSize.px15]: '15 px',
  [ChatBubbleFontSize.px16]: '16 px',
  [ChatBubbleFontSize.px18]: '18 px',
};

export const getChatBubbleFontSizeTextClassName = (
  value: ChatBubbleFontSize | null | undefined
) => chatBubbleFontSizeTextClassName[value ?? defaultChatBubbleFontSize];

export const getChatBubbleFontSizeLabel = (
  value: ChatBubbleFontSize | null | undefined
) => chatBubbleFontSizeLabel[value ?? defaultChatBubbleFontSize];
