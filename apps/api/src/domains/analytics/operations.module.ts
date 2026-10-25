import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "@root/modules/db";
import { OperationsService } from "./operations.service";

@Global()
@Module({ imports: [DatabaseModule], providers: [OperationsService], exports: [OperationsService] })
export class OperationsModule {}
