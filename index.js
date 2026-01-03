
// BASIC CONFIG
// const port = 4000;
const port = process.env.PORT || 4000;

const express = require("express");
const app = express();
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");

app.use(express.json());

app.use(cors({
  origin: "*",
  credentials: true
}));


// DATABASE CONNECTION
// mongoose.connect("mongodb+srv://awaiskhan:awais7800@cluster0.la19pgb.mongodb.net/e-commerce")
//   .then(() => console.log("MongoDB Connected"))
//   .catch(err => console.log("Mongo Error:", err));
// ======================
// ENV VARIABLES
// ======================
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;
const DB_NAME = process.env.DB_NAME;

// ======================
// MONGODB CONNECTION
// ======================
const MONGODB_URI = `mongodb+srv://${DB_USER}:${DB_PASS}@cluster0.la19pgb.mongodb.net/${DB_NAME}?retryWrites=true&w=majority`;

mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB Connected Successfully"))
  .catch((err) =>
    console.error("❌ MongoDB Connection Error:", err.message)
  );
app.get("/", (req, res) => {
  res.send("Express server is running...");
});

app.get("/allproducts", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 40,
      main,
      type,
      fabric,
      colors,
      clothTypes,
      pieces,
      minPrice,
      maxPrice,
      search
    } = req.query;

    const query = {};

    if (main) query.main_category = main;
    if (type) query.type = type;
    if (fabric) query.fabric_type = fabric;

    if (colors) query.color = { $in: colors.split(",") };
    if (clothTypes) query.cloth_type = { $in: clothTypes.split(",") };
    if (pieces) query.pieces = { $in: pieces.split(",") };

    if (minPrice || maxPrice) {
      query.new_price = {};
      if (minPrice) query.new_price.$gte = Number(minPrice);
      if (maxPrice) query.new_price.$lte = Number(maxPrice);
    }

    if (search) {
      query.product_name = { $regex: search, $options: "i" };
    }

    const total = await Product.countDocuments(query);

    const products = await Product.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ date: -1 });

    res.json({
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      products
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/newcollection', async (req, res) => {
  let products = await Product.find({});
  let newcollection = products.slice(1).slice(-8);
  res.send(newcollection);
});
// POPULAR IN WOMEN
app.get('/popularinwomen', async (req, res) => {
  let products = await Product.find({ main_category: "women" });
  res.send(products.slice(0, 4));
});
// GET a single product by product_id
app.get('/product/:id', async (req, res) => {
  try {
    const product_id = Number(req.params.id);

    const product = await Product.findOne({ product_id });

    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    res.json({ success: true, product });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to fetch product' });
  }
});
// GET related products by main_category & type (exclude current product)
app.get('/product/:id/related', async (req, res) => {
  try {
      const product_id = Number(req.params.id);

      const product = await Product.findOne({ product_id });

      if (!product) {
        return res.status(404).json({ success: false, error: 'Product not found' });
      }

      let filter = {
        product_id: { $ne: product_id },
        main_category: product.main_category,
        type: product.type
      };

      if (product.main_category === "kids") {
        filter.kids_category = product.kids_category; 
      }
      const related = await Product.find(filter).limit(10);
      res.json({ success: true, related });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: 'Failed to fetch related products' });
    } 
});
// USER MODEL
const Users = mongoose.model('Users', {
  name: String,
  email: { type: String, unique: true },
  password: String,
  cartData: Object,
  date: { type: Date, default: Date.now }
});
app.post('/signup', async (req, res) => {
  try {
    const check = await Users.findOne({ email: req.body.email });
    if (check) return res.status(400).json({ success: false, error: "User already exists" });

    const user = new Users({
      name: req.body.username,
      email: req.body.email,
      password: req.body.password,
      cartData: []  // ✔ empty cart
    });

    await user.save();
    const token = jwt.sign({ user: { id: user.id } }, "secret_ecom");
    res.json({ success: true, token });

  } catch (err) {
    res.status(500).json({ success: false, error: "Signup failed" });
  }
});
app.post('/login', async (req, res) => {
  try {
    const user = await Users.findOne({ email: req.body.email });
    if (!user) return res.json({ success: false, error: "Email not found" });
    if (req.body.password !== user.password) return res.json({ success: false, error: "Incorrect password" });

    const token = jwt.sign({ user: { id: user.id } }, "secret_ecom");
    res.json({ success: true, token });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: "Login failed" });
  }
});
const fetchUser = async (req, res, next) => {
  const token = req.header("auth-token");

  if (!token) {
    req.user = null; // 👈 guest user allowed
    return next();
  }

  try {
    const data = jwt.verify(token, "secret_ecom");
    req.user = data.user;
    next();
  } catch (err) {
    req.user = null; // treat invalid token as guest
    next();
  }
};
app.post('/addtocart', fetchUser, async (req, res) => {
  const { product_id, size, qty } = req.body;

  let user = await Users.findById(req.user.id);
  let cart = user.cartData;

  // Check if same product + same size exists
  let item = cart.find(
    (c) => c.product_id === product_id && c.size === size
  );

  if (item) {
    item.qty += qty;   // increase qty
  } else {
    cart.push({
      product_id,
      qty,
      size: size || null
    });
  }

  await Users.updateOne({ _id: user.id }, { cartData: cart });

  res.json({ success: true, cart });
});
app.post('/removefromcart', fetchUser, async (req, res) => {
  const { product_id, size } = req.body;

  let user = await Users.findById(req.user.id);
  let cart = user.cartData;

  cart = cart.filter(
    (c) => !(c.product_id === product_id && c.size === size)
  );

  await Users.updateOne({ _id: user.id }, { cartData: cart });

  res.json({ success: true, cart });
});
app.post('/getcart', fetchUser, async (req, res) => {
  let user = await Users.findById(req.user.id);
  res.json(user.cartData);
});
app.post('/savecart', fetchUser, async (req,res) => {
  await Users.updateOne({_id: req.user.id}, { cartData: req.body.cart });
  res.json({ success: true });
});

const Order = mongoose.model("Order", {
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Users",
    default: null,
  },

  guestInfo: {
    name: String,
    phone: String,
    email: String,
  },

  address: {
    name: String,
    phone: String,
    city: String,
    address: String,
  },

  cartItems: [
    {
      product_id: Number,
      size: String,
      qty: Number,
    },
  ],

  totalAmount: Number,
  status: { type: String, default: "Pending" },
  createdAt: { type: Date, default: Date.now },
});
app.post("/placeorder", fetchUser, async (req, res) => {
  try {
    const { address, totalAmount } = req.body;
    const user = await Users.findById(req.user.id);

    if (!user || user.cartData.length === 0) {
      return res.json({ success: false, msg: "Cart empty" });
    }

    const newOrder = new Order({
      userId: req.user.id,
      address,
      cartItems: user.cartData,
      totalAmount,
      status: "Pending",
    });

    await newOrder.save();

    // 🔔 REAL-TIME ADMIN NOTIFICATION
    // io.emit("new-order", {
    //   orderId: newOrder._id,
    //   totalAmount: newOrder.totalAmount,
    //   name: newOrder.address?.name || user.name || "Customer",
    //   createdAt: newOrder.createdAt
    // });
    const notification = await Notification.create({
      orderId: newOrder._id,
      name: newOrder.address?.name || user.name || "Customer",
      message: "placed a new order"
    });

    io.emit("new-order", {
      _id: notification._id,
      orderId: newOrder._id,
      name: notification.name,
      message: notification.message,
      createdAt: notification.createdAt
    });

    // 🧹 clear cart
    user.cartData = [];
    await user.save();

    res.json({ success: true, orderId: newOrder._id });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});
app.get("/myorders", fetchUser, async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.user.id })
      .sort({ createdAt: -1 });

    // ✅ collect product_id correctly
    const allProductIds = orders.flatMap(order =>
      order.cartItems.map(item => item.product_id)
    );

    const products = await Product.find({
      product_id: { $in: allProductIds }
    });

    const finalOrders = orders.map(order => ({
      ...order._doc,
      cartItems: order.cartItems.map(item => {
        const product = products.find(
          p => p.product_id === item.product_id
        );

        return {
          ...item._doc,
          product: product
            ? {
                product_id: product.product_id,
                product_name: product.product_name,
                image: product.image,
                new_price: product.new_price
              }
            : null
        };
      })
    }));

    res.json(finalOrders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});
app.get("/order/:id", fetchUser, async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      userId: req.user.id   // ✅ security
    });

    if (!order) {
      return res.status(404).json({ success: false, msg: "Order not found" });
    }

    const productIds = order.cartItems.map(i => i.product_id);

    const products = await Product.find({
      product_id: { $in: productIds }
    });

    const items = order.cartItems.map(item => {
      const product = products.find(
        p => p.product_id === item.product_id
      );

      return {
        ...item.toObject(),   // ✅ FIX HERE
        product: product
          ? {
              product_id: product.product_id,
              product_name: product.product_name,
              image: product.image,
              new_price: product.new_price
            }
          : null
      };
    });

    res.json({
      ...order.toObject(),
      cartItems: items
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});


const Review = mongoose.model('Review', {
  product_id: { type: Number, required: true },     // updated field name
  name: { type: String, required: false },
  rating: { type: Number, required: true, min: 1, max: 5 },
  text: { type: String, required: true },
  date: { type: Date, default: Date.now }
});
app.get('/product/:id/reviews', async (req, res) => {
  try {
    const product_id = Number(req.params.id);

    const reviews = await Review.find({ product_id }).sort({ date: -1 });

    res.json({ success: true, reviews });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to fetch reviews' });
  }
});
app.post('/product/:id/reviews', fetchUser, async (req, res) => {
  try {
    const product_id = Number(req.params.id);
    const { name, rating, text } = req.body;

    if (!rating || !text) {
      return res.status(400).json({ success: false, error: 'Rating and text are required' });
    }

    // Automatically fill name from user if not passed
    const reviewName = name && name.trim() !== "" ? name : req.user.name || "Anonymous";

    const review = new Review({
      product_id,
      name: reviewName,
      rating,
      text
    });

    await review.save();

    res.json({ success: true, review });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to post review' });
  }
});

const storage = multer.diskStorage({
  destination: './upload/images',
  filename: (req, file, cb) => {
    cb(null, `${file.fieldname}_${Date.now()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage });
// Static folder
app.use('/images', express.static('upload/images'));
app.post("/upload-main", upload.single("main_image"), (req, res) => {
  // res.json({ success: true, image_url: `http://localhost:${port}/images/${req.file.filename}` });
  res.json({
  success: true,
  image_url: `${req.protocol}://${req.get("host")}/images/${req.file.filename}`
});

});
app.post("/upload-detail", upload.single("detail_image"), (req, res) => {
  res.json({ success: true, image_url: `http://localhost:${port}/images/${req.file.filename}` });
});

const ProductSchema = new mongoose.Schema({
  product_id: { type: Number, required: true },

  product_code: { type: String, required: true, unique: true },

  main_category: { type: String, required: true },
  sub_category: { type: String, required: true },

  type: {
    type: String,
    enum: ["stitched", "unstitched", "accessories"],
    required: true
  },

  fabric_type: { type: String },

  cloth_type: {
    type: String,
    enum: ["embroidered", "printed", "solid"],
    default: ""
  },

  pieces: {
    type: [String],
    enum: ["one", "two", "three"],
    default: []
  },

  product_name: { type: String },
  color: { type: String },
  description: { type: String },

  image: { type: String },
  detail_images: { type: [String], default: [] },

  new_price: { type: Number },
  old_price: { type: Number },

  gender: {
    type: String,
    enum: ["boy", "girl", null],
    default: null
  },

  sizes: { type: Map, of: Number, default: {} },

  total_qty: { type: Number, default: 0 },

  date: { type: Date, default: Date.now },
  available: { type: Boolean, default: true }
});

ProductSchema.index({
  main_category: 1,
  type: 1,
  fabric_type: 1,
  new_price: 1,
  color: 1,
  pieces: 1,
});

/* ✅ MODEL */
const Product = mongoose.model("Product", ProductSchema);

// ADD PRODUCT
app.post('/addproduct', async (req, res) => {
  try {
    let products = await Product.find({});
    let product_id = products.length > 0 
        ? products[products.length - 1].product_id + 1 
        : 1;

    // Check if product_code already exists
    const exists = await Product.findOne({ product_code: req.body.product_code });
    if (exists) {
      return res.json({ success: false, message: "Product Code already exists!" });
    }

    const product = new Product({
      product_id,
      product_code: req.body.product_code, 
      main_category: req.body.main_category,
      sub_category: req.body.sub_category,
      type: req.body.type,
      fabric_type: req.body.fabric_type,
      cloth_type: req.body.cloth_type,   
      pieces: req.body.pieces || [],
      product_name: req.body.product_name,
      color: req.body.color,
      description: req.body.description,

      image: req.body.image,
      detail_images: req.body.detail_images,

      new_price: req.body.new_price,
      old_price: req.body.old_price,

      sizes: req.body.sizes || {},
      total_qty: req.body.total_qty || 0,

      gender: req.body.gender || null
    });

    await product.save();

    res.json({ success: true, message: "Product added successfully!" });

  } catch (err) {
    console.log(err);
    res.json({ success: false, message: "Failed to add product" });
  }
});
// DELETE PRODUCT
app.post('/removeproduct', async (req, res) => {
  try {
    const product = await Product.findOne({ product_id: req.body.product_id });
    if (!product) return res.json({ success: false, message: "Product not found" });

    // Delete main image
    if (product.image) {
      const mainPath = path.join(__dirname, 'upload/images', path.basename(product.image));
      if (fs.existsSync(mainPath)) fs.unlinkSync(mainPath);
    }

    // Delete detail images
    product.detail_images.forEach(img => {
      if (img) {
        const imgPath = path.join(__dirname, 'upload/images', path.basename(img));
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
      }
    });

    await Product.deleteOne({ product_id: req.body.product_id });
    res.json({ success: true, message: "Product deleted successfully" });

  } catch (err) {
    console.log(err);
    res.json({ success: false, message: "Failed to delete product" });
  }
});
// UPDATE PRODUCT
app.put('/updateproduct/:product_id', async (req, res) => {
  try {
    const id = req.params.product_id;
    const updatedData = req.body;

    const product = await Product.findOne({ product_id: id });
    if (!product)
      return res.status(404).json({ success: false, error: 'Product not found' });

    // Check duplicate product_code
    if (updatedData.product_code && updatedData.product_code !== product.product_code) {
      const exists = await Product.findOne({ product_code: updatedData.product_code });
      if (exists) {
        return res.json({ success: false, message: "Product Code already exists!" });
      }
      product.product_code = updatedData.product_code;
    }

    // Main image replace
    if (updatedData.image && updatedData.image !== product.image) {
      const oldPath = path.join(__dirname, 'upload/images', path.basename(product.image));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      product.image = updatedData.image;
    }

    // Replace detail images
    if (updatedData.detail_images) {
      for (let i = 0; i < updatedData.detail_images.length; i++) {
        if (updatedData.detail_images[i] !== product.detail_images[i]) {
          const oldPath = path.join(__dirname, 'upload/images', path.basename(product.detail_images[i]));
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
      }
      product.detail_images = updatedData.detail_images;
    }

    const fields = [
      "main_category", "sub_category", "type",  "fabric_type","cloth_type", "pieces",
      "product_name", "color", "description",
      "new_price", "old_price", "sizes",
      "total_qty", "gender"
    ];

    fields.forEach(f => {
      if (updatedData[f] !== undefined) product[f] = updatedData[f];
    });

    await product.save();

    res.json({ success: true, product });

  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: "Failed to update product" });
  }
});

// GET /products?limit=100&skip=0&type=stitched&sub_category=winter&q=abc
app.get('/products', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit || '100'))); // default 100
    const skip = Math.max(0, parseInt(req.query.skip || '0'));
    const type = req.query.type; // stitched | unstitched | accessories
    const sub_category = req.query.sub_category; // winter | summer
    const main_category = req.query.main_category; // winter | summer
    const q = req.query.q ? String(req.query.q).trim() : '';

    // Build query
    const query = {};
    if (type && type !== 'all') query.type = type;
    if (sub_category && sub_category !== 'all') query.sub_category = sub_category;
       if (main_category && main_category !== 'all') query.main_category = main_category;

    if (q) {
      // search product_code or product_name (case-insensitive)
      query.$or = [
        { product_code: { $regex: q, $options: 'i' } },
        { product_name: { $regex: q, $options: 'i' } }
      ];
    }

    const [products, total] = await Promise.all([
      Product.find(query).sort({ date: -1 }).skip(skip).limit(limit).lean(),
      Product.countDocuments(query)
    ]);

    res.json({ success: true, products, total, skip, limit });
  } catch (err) {
    console.error('GET /products error', err);
    res.status(500).json({ success: false, error: 'Failed to fetch products' });
  }
});
// IMPORT PRODUCTS
app.post("/importproducts", async (req, res) => {
  try {
    const productList = req.body.products;

    if (!Array.isArray(productList) || productList.length === 0) {
      return res.json({ success: false, message: "Invalid or empty JSON format" });
    }

    // Auto-generate product_id for each
    let last = await Product.findOne().sort({ product_id: -1 });
    let startId = last ? last.product_id + 1 : 1;

    const formatted = productList.map((p, idx) => ({
      ...p,
      product_id: startId + idx,
    }));

    // insertMany with ordered:false to skip duplicates and continue
    await Product.insertMany(formatted, { ordered: false });

    res.json({ success: true, message: "Products imported successfully!" });
  } catch (err) {
    console.error("Import Error:", err);
    res.status(500).json({ success: false, message: "Failed to import data", error: err.message });
  }
});

// FabricType model + CRUD routes
// const { Schema } = require('mongoose');
// const FabricTypeSchema = new Schema({
//   fabric_category: {
//     type: String,
//     enum: ['stitched', 'unstitched', 'accessories'],
//     required: true
//   },
//   fabric_types: {
//     type: [String],
//     default: []
//   },
//   createdAt: {
//     type: Date,
//     default: Date.now
//   }
// });
// const FabricType = mongoose.model('FabricType', FabricTypeSchema);
// app.post('/fabric-type', async (req, res) => {
//   try {
//     const { fabric_category, fabric_types } = req.body;
//     if (!fabric_category) return res.status(400).json({ success: false, error: 'fabric_category required' });

//     const doc = new FabricType({
//       fabric_category,
//       fabric_types: Array.isArray(fabric_types) ? fabric_types : (fabric_types ? [fabric_types] : [])
//     });

//     await doc.save();
//     res.json({ success: true, fabricType: doc });
//   } catch (err) {
//     console.error('Create FabricType error:', err);
//     res.status(500).json({ success: false, error: 'Server error' });
//   }
// });
// app.get('/fabric-types', async (req, res) => {
//   try {
//     const category = req.query.category;
//     const query = category ? { fabric_category: category } : {};
//     const list = await FabricType.find(query).sort({ createdAt: -1 });
//     // return array (each doc has fabric_types array)
//     res.json(list);
//   } catch (err) {
//     console.error('Get FabricTypes error:', err);
//     res.status(500).json({ success: false, error: 'Server error' });
//   }
// });
// app.put('/fabric-type/:id', async (req, res) => {
//   try {
//     const id = req.params.id;
//     const { fabric_category, fabric_types } = req.body;
//     const updated = await FabricType.findByIdAndUpdate(
//       id,
//       { fabric_category, fabric_types: Array.isArray(fabric_types) ? fabric_types : (fabric_types ? [fabric_types] : []) },
//       { new: true }
//     );
//     if (!updated) return res.status(404).json({ success: false, error: 'Not found' });
//     res.json({ success: true, fabricType: updated });
//   } catch (err) {
//     console.error('Update FabricType error:', err);
//     res.status(500).json({ success: false, error: 'Server error' });
//   }
// });
// app.delete('/fabric-type/:id', async (req, res) => {
//   try {
//     const id = req.params.id;
//     const removed = await FabricType.findByIdAndDelete(id);
//     if (!removed) return res.status(404).json({ success: false, error: 'Not found' });
//     res.json({ success: true });
//   } catch (err) {
//     console.error('Delete FabricType error:', err);
//     res.status(500).json({ success: false, error: 'Server error' });
//   }
// });


// --- ADMIN model (separate from Users) ---
const { Schema } = require('mongoose');

const FabricTypeSchema = new Schema({
  main_category: {                       // ✅ NEW
    type: String,
    enum: ['men', 'women', 'kids'],
    required: true
  },

  fabric_category: {
    type: String,
    enum: ['stitched', 'unstitched', 'accessories'],
    required: true
  },

  fabric_types: {
    type: [String],
    default: []
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

// ✅ prevent duplicate men+stitched etc
FabricTypeSchema.index(
  { main_category: 1, fabric_category: 1 },
  { unique: true }
);

const FabricType = mongoose.model('FabricType', FabricTypeSchema);
app.post('/fabric-type', async (req, res) => {
  try {
    const { main_category, fabric_category, fabric_types } = req.body;

    if (!main_category || !fabric_category)
      return res.status(400).json({ success: false, error: 'main_category & fabric_category required' });

    const doc = new FabricType({
      main_category,
      fabric_category,
      fabric_types: Array.isArray(fabric_types)
        ? fabric_types
        : (fabric_types ? [fabric_types] : [])
    });

    await doc.save();
    res.json({ success: true, fabricType: doc });

  } catch (err) {
    if (err.code === 11000) {
      return res.json({ success: false, error: 'Already exists for this category' });
    }
    res.status(500).json({ success: false, error: 'Server error' });
  }
});
app.get("/fabric-types", async (req, res) => {
  try {
    const { main_category, fabric_category } = req.query;

    const query = {};
    if (main_category) query.main_category = main_category;
    if (fabric_category) query.fabric_category = fabric_category;

    const list = await FabricType.find(query);
    res.json(list);
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.put('/fabric-type/:id', async (req, res) => {
  try {
    const { main_category, fabric_category, fabric_types } = req.body;

    const updated = await FabricType.findByIdAndUpdate(
      req.params.id,
      {
        main_category,
        fabric_category,
        fabric_types: Array.isArray(fabric_types)
          ? fabric_types
          : (fabric_types ? [fabric_types] : [])
      },
      { new: true }
    );

    if (!updated) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, fabricType: updated });

  } catch (err) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});
app.delete('/fabric-type/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const removed = await FabricType.findByIdAndDelete(id);
    if (!removed) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

const AdminUser = mongoose.model('AdminUser', {
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'staff'], default: 'staff' },
  blocked: { type: Boolean, default: false },  // 👈 NEW FIELD
  date: { type: Date, default: Date.now }
});
const ADMIN_JWT_SECRET = "admin_secret_key_here";
app.post('/admin/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // if any admin exists you might want to disallow public signup
    const existingAdmins = await AdminUser.findOne({});
    if (existingAdmins) {
      return res.status(403).json({ success: false, message: "Admin signup disabled. Use /admin/create-staff or create first admin manually."});
    }

    const admin = new AdminUser({ name, email, password, role: 'admin' });
    await admin.save();

    const token = jwt.sign({ id: admin._id, role: admin.role }, ADMIN_JWT_SECRET, { expiresIn: '8h' });

    res.json({ success: true, token, role: admin.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to create admin' });
  }
});
app.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await AdminUser.findOne({ email });

    if (!user) 
      return res.status(400).json({ success: false, message: 'Email not found' });

    if (user.password !== password)
      return res.status(400).json({ success: false, message: 'Incorrect password' });

    if (user.blocked === true)
      return res.status(403).json({ success: false, message: 'Your account is blocked. Contact admin.' });

    const token = jwt.sign({
      id: user._id,
      role: user.role
    }, ADMIN_JWT_SECRET, { expiresIn: '8h' });

    res.json({ success: true, token, role: user.role, name: user.name });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// admin auth middleware (for admin/staff)
const adminAuth = (req, res, next) => {
  const token = req.header('admin-auth-token');
  if (!token) return res.status(401).json({ success: false, message: 'No admin token provided' });

  try {
    const data = jwt.verify(token, ADMIN_JWT_SECRET);
    req.admin = data; // { id, role }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid admin token' });
  }
};
const adminOnly = (req, res, next) => {
  if (!req.admin || req.admin.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin only' });
  }
  next();
};
const staffOrAdmin = (req, res, next) => {
  if (!req.admin) return res.status(403).json({ success: false, message: 'Admin/Staff only' });
  if (req.admin.role === 'admin' || req.admin.role === 'staff') return next();
  return res.status(403).json({ success: false, message: 'Access denied' });
};
app.post("/admin/create-staff", adminAuth, adminOnly, async (req, res) => {
  const { name, email, password } = req.body;

  // staff role always
  const role = "staff";

  // check inside AdminUser collection
  const exists = await AdminUser.findOne({ email });
  if (exists)
    return res.json({ success: false, error: "Email already used" });

  const staff = new AdminUser({ name, email, password, role });
  await staff.save();

  res.json({ success: true, message: "Staff account created successfully" });
});
app.get('/admin/staff', adminAuth, adminOnly, async (req, res) => {
  const staff = await AdminUser.find({ role: 'staff' }).select('-password');
  res.json({ success: true, staff });
});
app.put('/admin/staff/block/:id', adminAuth, adminOnly, async (req, res) => {
  const staff = await AdminUser.findById(req.params.id);
  if (!staff) return res.json({ success: false, message: "Staff not found" });

  staff.blocked = !staff.blocked;  
  await staff.save();

  res.json({ success: true, message: "Status updated", blocked: staff.blocked });
});
app.put('/admin/staff/update/:id', adminAuth, adminOnly, async (req, res) => {
  const { name, email } = req.body;

  const updated = await AdminUser.findByIdAndUpdate(
    req.params.id,
    { name, email },
    { new: true }
  );

  res.json({ success: true, updated });
});

app.get('/admin/reviews', adminAuth, staffOrAdmin, async (req, res) => {
  try {
    const reviews = await Review.find().sort({ date: -1 });
    res.json({ success: true, reviews });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
  }
});
app.delete('/admin/review/:id', adminAuth, adminOnly, async (req, res) => {
  try {
    await Review.deleteOne({ _id: req.params.id });
    res.json({ success: true, message: 'Review deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to delete review' });
  }
});
app.put('/admin/review/:id', adminAuth, adminOnly, async (req, res) => {
  try {
    const updated = await Review.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, review: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update review' });
  }
});

//order management 
app.get('/admin/orders', adminAuth, staffOrAdmin, async (req, res) => {
  try {
  const { page = 1, limit = 5, status, sort = "new" } = req.query;

  const query = status && status !== "All" ? { status } : {};

  const orders = await Order.find(query)
    .sort({ createdAt: sort === "new" ? -1 : 1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  const total = await Order.countDocuments(query);

    // collect product_ids
    const productIds = orders.flatMap(order =>
      order.cartItems.map(item => item.product_id)
    );

    const products = await Product.find({
      product_id: { $in: productIds }
    });

    const finalOrders = orders.map(order => ({
      ...order._doc,
      cartItems: order.cartItems.map(item => {
        const product = products.find(
          p => p.product_id === item.product_id
        );

        return {
          ...item._doc,
          product: product
            ? {
                product_name: product.product_name,
                image: product.image,
                new_price: product.new_price,
                product_code : product.product_code,
              }
            : null
        };
      })
    }));

    res.json({
    success: true,
    orders: finalOrders,
    totalPages: Math.ceil(total / limit)
  });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});
app.put("/admin/order-status", adminAuth, staffOrAdmin, async (req, res) => {
  try {
    const { orderId, status } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    // 🚫 prevent re-update after delivered
    if (order.status === "Delivered") {
      return res.json({
        success: false,
        message: "Order already delivered"
      });
    }

    // ============================
    // ✅ DELIVERED (FINAL STATE)
    // ============================
    if (status === "Delivered") {
      for (const item of order.cartItems) {
        const product = await Product.findOne({ product_id: item.product_id });
        if (!product) continue;

        if (item.size && product.sizes?.has(item.size)) {
          const currentQty = product.sizes.get(item.size) || 0;
          product.sizes.set(item.size, Math.max(0, currentQty - item.qty));
        }

        product.total_qty = Math.max(0, product.total_qty - item.qty);

        if (product.total_qty === 0) {
          product.available = false;
        }

        await product.save();
      }

      order.status = "Delivered"; // ✅ FINAL
      await order.save();

      io.emit("order-status-updated", { orderId, status: "Delivered" });

      return res.json({ success: true });
    }

    // ============================
    // NORMAL STATUS UPDATE
    // ============================
    order.status = status;
    await order.save();

    io.emit("order-status-updated", { orderId, status });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});
app.delete('/admin/order/:id', adminAuth, staffOrAdmin, async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});
app.get("/admin/order-stats", adminAuth, staffOrAdmin, async (req, res) => {
  try {
    const { status, from, to } = req.query;

    const query = {};
    if (status && status !== "All") query.status = status;
    if (from && to) {
      query.createdAt = {
        $gte: new Date(from),
        $lte: new Date(to)
      };
    }

    const orders = await Order.find(query);

    const stats = {
      totalOrders: orders.length,
      totalRevenue: orders.reduce((sum, o) => sum + o.totalAmount, 0),
      Pending: 0,
      Confirmed: 0,
      Shipped: 0,
      Completed: 0,
      Cancelled: 0
    };

    orders.forEach(o => {
      if (stats[o.status] !== undefined) stats[o.status]++;
    });

    // 📊 group by date
    const salesByDate = {};
    orders.forEach(o => {
      const date = o.createdAt.toISOString().split("T")[0];
      salesByDate[date] = (salesByDate[date] || 0) + o.totalAmount;
    });

    const chartData = Object.keys(salesByDate).map(date => ({
      date,
      sales: salesByDate[date]
    }));

    res.json({ success: true, stats, chartData });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

const Notification = mongoose.model(
  "Notification",
  new mongoose.Schema(
    {
      type: { type: String, default: "order" },
      orderId: mongoose.Schema.Types.ObjectId,
      name: String,
      message: String,
      read: { type: Boolean, default: false }
    },
    { timestamps: true }
  )
);
app.get("/admin/notifications", adminAuth, async (req, res) => {
  const list = await Notification.find().sort({ createdAt: -1 });
  res.json({ success: true, notifications: list });
});
app.put("/admin/notifications/read", adminAuth, async (req, res) => {
  await Notification.updateMany({ read: false }, { read: true });
  res.json({ success: true });
});
app.delete("/admin/notifications/:id", adminAuth, async (req, res) => {
  await Notification.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});
app.delete("/admin/notifications", adminAuth, async (req, res) => {
  await Notification.deleteMany();
  res.json({ success: true });
});


const http = require("http");
const { Server } = require("socket.io");

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

io.on("connection", socket => {
  console.log("Admin connected:", socket.id);
});

// 🔔 expose io globally
global.io = io;

server.listen(port, () => {
  console.log("Server running on port", port);
});

