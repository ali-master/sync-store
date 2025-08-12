import { InjectTransactionHost } from "@nestjs-cls/transactional";

export const InjectDbTransactor = () => InjectTransactionHost();
