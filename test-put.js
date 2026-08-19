const { buildColumnValues } = require("./src/modules/announcements/store");
const body = { coverImage: "test-image.jpg" };
const { columns, values } = buildColumnValues("events", body, { partial: true });
console.log(columns, values);
