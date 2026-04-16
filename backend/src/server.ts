import app from "./app";
import { env } from "./config";

const port = env.PORT;

app.listen(port, () => {
  console.log(`Iron Booking API is running on port ${port}`);
});