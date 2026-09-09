import { SetMetadata } from "@nestjs/common";

export const RAW_RESPONSE = "raw-response";
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);
