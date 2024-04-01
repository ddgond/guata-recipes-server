import 'dotenv/config';
import chalk from 'chalk';
import { MongoClient } from 'mongodb';
import express from 'express';
import bodyParser from "body-parser";
import slowDown from 'express-slow-down';

const mongoClient = new MongoClient(process.env.MONGO_URL);
const dbName = process.env.DB_NAME;
const recipesCollectionName = process.env.RECIPES_COLLECTION_NAME;

const recursiveHighlight = (phrase, keywords) => {
  if (keywords.length === 0) {
    return phrase;
  }
  return phrase.split(keywords[0]).map(token => recursiveHighlight(token, keywords.slice(1))).join(chalk.blue(keywords[0]));
}

class Ingredient {
  constructor(entry, keywords) {
    this.entry = entry;
    this.keywords = [...keywords];
    this.keywords.sort((a,b) => b.length - a.length);
  }
  toString() {
    return this.entry;
  }
  highlightedString() {
    let keywords = [...this.keywords];
    keywords = keywords.map(keyword => keyword.toLowerCase());
    return recursiveHighlight(this.toString(), keywords);
  }
  static fromJSON(json) {
    if (!json.entry || typeof json.entry != 'string' || json.entry.length < 1) {
      throw 'Invalid JSON.';
    }
    if (!json.keywords || json.keywords.some(keyword => typeof keyword != 'string' || keyword.length < 1)) {
      throw 'Invalid JSON.';
    }
    return new Ingredient(json.entry, json.keywords);
  }
}

class Step {
  constructor(text, isHeading) {
    this.text = text;
    this.isHeading = isHeading;
  }
  toString() {
    return this.text;
  }
  highlightedString(ingredients) {
    let keywords = ingredients.reduce((prev, ingredient) => prev.concat(ingredient.keywords), []);
    keywords = keywords.map(keyword => keyword.toLowerCase());
    keywords.sort((a,b) => b.length - a.length);

    return recursiveHighlight(this.toString(), keywords);
  }
  static fromJSON(json) {
    if (!json.text || typeof json.text != 'string' || json.text.length < 1 || typeof json.isHeading != 'boolean') {
      throw 'Invalid JSON.';
    }
    return new Step(json.text, json.isHeading);
  }
}

class Recipe {
  constructor(name, description, tags, serves, ingredients, steps) {
    this.name = name;
    this.description = description;
    this.tags = tags;
    this.serves = serves;
    this.ingredients = [...ingredients];
    this.steps = [...steps];
  }

  toString() {
    let result = `====${this.name.toUpperCase()}====\n${this.description}\n===Ingredients===\n`;
    this.ingredients.forEach(ingredient => {
      result += `${ingredient.highlightedString()}\n`;
    });
    result += '===Steps===\n';
    this.steps.forEach((step, i) => {
      result += `${i+1}) ${step.highlightedString(this.ingredients)}\n`;
    });
    return result;
  }

  static fromJSON(json) {
    if (!json.name || !json.description || !json.tags || !json.serves || !json.ingredients || !json.steps) {
      throw 'Invalid JSON.';
    }
    if (typeof json.name != 'string' || typeof json.description != 'string' || typeof json.serves != 'string') {
      throw 'Invalid JSON.';
    }
    if (json.name.length < 1 || json.description.length < 1 || json.serves < 1) {
      throw 'Invalid JSON.';
    }
    if (json.ingredients.length < 1 || json.steps.length < 1 || json.tags.length < 1) {
      throw 'Invalid JSON.';
    }
    if (json.tags.some(tag => typeof tag != 'string' || tag.length < 1)) {
      throw 'Invalid JSON.';
    }
    const ingredients = json.ingredients.map(ingredient => Ingredient.fromJSON(ingredient));
    const steps = json.steps.map(step => Step.fromJSON(step));
    const tags = [...json.tags];
    return new Recipe(json.name, json.description, tags, json.serves, ingredients, steps);
  }
}

class RecipeBook {
  constructor() {
    this.recipes = [];
  }

  add(recipe) {
    this.recipes.push(recipe);
  }

  replaceRecipe(recipe, previousName) {
    this.deleteRecipe(previousName);
    this.add(recipe);
  }

  deleteRecipe(recipeName) {
    this.recipes.splice(this.recipes.findIndex(recipe => recipe.name === recipeName), 1);
  }

  toString() {
    let result = '=====RECIPE BOOK=====\n\n'
    this.recipes.forEach(recipe => {
      result += `${recipe.toString()}\n`;
    })
    return result
  }

  clear() {
    this.recipes = [];
  }
}

const recipeBook = new RecipeBook();

const uploadRecipe = (recipe) => {
  const db = mongoClient.db(dbName);
  const recipesCollection = db.collection(recipesCollectionName);
  return recipesCollection.insertOne(recipe).then(() => {});
}

const replaceRecipe = (recipe, previousName) => {
  const db = mongoClient.db(dbName);
  const recipesCollection = db.collection(recipesCollectionName);
  const filter = {
    name: previousName
  };
  return recipesCollection.replaceOne(filter, recipe).then(() => {});
}

const deleteRecipe = (recipeName) => {
  const db = mongoClient.db(dbName);
  const recipesCollection = db.collection(recipesCollectionName);
  const filter = {
    name: recipeName
  };
  return recipesCollection.deleteOne(filter).then(() => {})
}

const updateRecipes = () => {
  const db = mongoClient.db(dbName);
  const recipesCollection = db.collection(recipesCollectionName);
  return recipesCollection.find({}).toArray().then(recipesData => {
    recipeBook.clear();
    recipesData.forEach(recipeData => {
      recipeBook.add(Recipe.fromJSON(recipeData));
    });
  }).catch(err=>{
    console.error(err);
  });
}

const updatingDbRecipes = false; // Set to true ONLY when in use
/**
 * Used for adding fields to existing recipes.
 */
const forceDbRecipeUpdate = () => {
  recipeBook.recipes.forEach(recipe => {
    replaceRecipe(recipe, recipe.name);
  });
}

console.log('Connecting to mongoDB...');
mongoClient.connect().then(() => {
  console.log('Connected to mongoDB.');
  updateRecipes().then(() => {
    if (updatingDbRecipes) {
      forceDbRecipeUpdate();
    }
  });
  setInterval(() => {
    updateRecipes();
  }, 30000);
}).catch(err => {
  console.error('Failed to connect to mongoDB.');
  console.error(err);
});

const app = express();
const port = process.env.PORT;

app.enable("trust proxy"); // only if you're behind a reverse proxy (Heroku, Bluemix, AWS if you use an ELB, custom Nginx setup, etc)

const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 100, // allow 100 requests per 15 minutes, then...
  delayMs: 500 // begin adding 500ms of delay per request above 100:
});

app.get('/api', (req, res) => {
  res.send(recipeBook);
});

app.delete('/api/recipe/*', speedLimiter, bodyParser.json(), (req, res) => {
  const name = req.params[0];
  if (req.body.password !== process.env.PASSWORD) {
    setTimeout(() => {
      console.log('Attempted DELETE with incorrect password denied.');
      res.status(401).send('Incorrect password.');
    }, 1000);
    return;
  }
  deleteRecipe(name).then(() => {
    recipeBook.deleteRecipe(name);
    res.json(name);
  }).catch(err => {
    res.status(500).send('Failed to delete recipe in database.');
  })
})

app.post('/api/recipe', speedLimiter, bodyParser.json(), (req, res) => {
  const recipeData = req.body;
  if (recipeData.password !== process.env.PASSWORD) {
    setTimeout(() => {
      console.log('Attempted POST with incorrect password denied.');
      res.status(401).send('Incorrect password.');
    }, 1000);
    return;
  }
  try {
    const newRecipe = Recipe.fromJSON(recipeData);
    if (recipeBook.recipes.some(recipe => recipe.name === newRecipe.name) && !(recipeData.edit && newRecipe.name === recipeData.previousName)) {
        res.status(400).send(`Recipe with name '${newRecipe.name}' already exists.`);
    } else {
      if (recipeData.edit) {
        replaceRecipe(newRecipe, recipeData.previousName).then(() => {
          recipeBook.replaceRecipe(newRecipe, recipeData.previousName);
          res.json(newRecipe);
        }).catch(err => {
          res.status(500).send('Failed to update recipe in database.');
        })
      } else {
        uploadRecipe(newRecipe).then(() => {
          recipeBook.add(newRecipe);
          res.json(newRecipe);
        }).catch(err => {
          res.status(500).send('Failed to store recipe in database.');
        });
      }
    }
  } catch (e) {
    console.error(e);
    res.status(400).send(e);
  }
})

app.listen(port, () => {
  console.log(`Express listening on port ${port}.`);
})
