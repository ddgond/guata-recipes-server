Example at https://recipes.guata.me

Before running, create a `.env` file in the root of this directory with the following contents:

```
MONGO_URL="[mongodb connection url (usually starts with 'mongodb://' or 'mongodb+srv://')]"
DB_NAME="[mongodb database name]"
RECIPES_COLLECTION_NAME="[mongodb collection name within DB_NAME]"
PASSWORD="[auth password for api requests]"
```

Run the server with `npm start`.
