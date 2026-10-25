const admin = db.getSiblingDB("admin");
if (!admin.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD)) quit(1);
try {
  if (admin.runCommand({ hello: 1 }).isWritablePrimary && admin.runCommand({ hello: 1 }).setName === "rs0") quit(0);
  rs.status();
} catch (error) {
  if (error.code === 94) rs.initiate({ _id: "rs0", members: [{ _id: 0, host: process.env.MONGO_REPLICA_HOST || "mongodb:27017" }] });
  else throw error;
}
quit(1);
