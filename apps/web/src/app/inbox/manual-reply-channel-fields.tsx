"use client";

import { useState } from "react";

type ManualReplyChannelFieldsProps = {
  allowedChannels: string[];
  defaultChannel: string;
  defaultSubject: string;
  options: Array<{
    label: string;
    value: string;
  }>;
};

export function ManualReplyChannelFields({
  allowedChannels,
  defaultChannel,
  defaultSubject,
  options,
}: ManualReplyChannelFieldsProps) {
  const [channel, setChannel] = useState(defaultChannel);
  const isSms = channel === "sms";

  return (
    <>
      <label>
        <strong>Channel</strong>
        <select
          defaultValue={defaultChannel}
          name="channelType"
          onChange={(event) => setChannel(event.currentTarget.value)}
        >
          {options.map((option) => {
            const isAllowed = allowedChannels.includes(option.value);

            return (
              <option disabled={!isAllowed} key={option.value} value={option.value}>
                {option.label}
                {isAllowed ? "" : " disabled"}
              </option>
            );
          })}
        </select>
      </label>

      {isSms ? (
        <input name="subject" readOnly type="hidden" value="" />
      ) : (
        <label className="manual-reply-subject-field">
          Subject
          <input defaultValue={defaultSubject} name="subject" type="text" />
        </label>
      )}
    </>
  );
}
