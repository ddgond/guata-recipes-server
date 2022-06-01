import chalk from 'chalk';
import { MongoClient } from 'mongodb';
import express from 'express';
import bodyParser from "body-parser";

const mongoClient = new MongoClient('mongodb+srv://admin:CKLBIE1mIJBzcgAj@cooking0.xmym8.mongodb.net/?retryWrites=true&w=majority');
const dbName = 'database';
const recipesCollectionName = 'recipes';

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
      throw 'Invalid JSON';
    }
    if (!json.keywords || json.keywords.some(keyword => typeof keyword != 'string' || keyword.length < 1)) {
      throw 'Invalid JSON';
    }
    return new Ingredient(json.entry, json.keywords);
  }
}

class Step {
  constructor(text) {
    this.text = text;
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
    if (!json.text || typeof json.text != 'string' || json.text.length < 1) {
      throw 'Invalid JSON';
    }
    return new Step(json.text);
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
      throw 'Invalid JSON';
    }
    if (typeof json.name != 'string' || typeof json.description != 'string' || typeof json.serves != 'number') {
      throw 'Invalid JSON';
    }
    if (json.name.length < 1 || json.description.length < 1 || json.serves < 1) {
      throw 'Invalid JSON';
    }
    if (json.ingredients.length < 1 || json.steps.length < 1 || json.tags.length < 1) {
      throw 'Invalid JSON';
    }
    if (json.tags.some(tag => typeof tag != 'string' || tag.length < 1)) {
      throw 'Invalid JSON';
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
  console.log('Preparing to upload new recipe.');
  const db = mongoClient.db(dbName);
  const recipesCollection = db.collection(recipesCollectionName);
  return recipesCollection.insertOne(recipe).then(() => {
    console.log('Done uploading new recipe.');
  });
}

const updateRecipes = () => {
  console.log('Updating recipe book...');
  const db = mongoClient.db(dbName);
  const recipesCollection = db.collection(recipesCollectionName);
  recipesCollection.find({}).toArray().then(recipesData => {
    recipeBook.clear();
    recipesData.forEach(recipeData => {
      recipeBook.add(Recipe.fromJSON(recipeData));
    });
    console.log(`Done updating recipes! ${recipeBook.recipes.length} recipes loaded!`);
  }).catch(err=>{
    console.error(err);
  });
}

mongoClient.connect().then(() => {
  updateRecipes();
  setInterval(() => {
    updateRecipes();
  }, 30000);
}).catch(err => {
  console.error(err);
});

const app = express();
const port = 8000;

app.get('/api', (req, res) => {
  res.send(recipeBook);
});

app.post('/api/recipe', bodyParser.json(), (req, res) => {
  const recipeData = req.body;
  try {
    const newRecipe = Recipe.fromJSON(recipeData);
    if (recipeBook.recipes.some(recipe => recipe.name === newRecipe.name)) {
      res.status(400).send(`Recipe with name '${newRecipe.name}' already exists.`);
    } else {
      recipeBook.add(newRecipe);
      uploadRecipe(newRecipe).then(() => {
        res.json(newRecipe);
      }).catch(err => {
        res.status(500).send('Failed to store recipe in database.');
      });
    }
  } catch (e) {
    res.status(400).send(e);
  }
})

app.listen(port, () => {
  console.log(`Express listening on port ${port}.`);
})