const { buildColumnValues } = require("./src/modules/announcements/store");
const body = { coverImageUrl: "test-image2.jpg" };
const { columns, values } = buildColumnValues("events", body, { partial: true });
console.log(columns, values);
