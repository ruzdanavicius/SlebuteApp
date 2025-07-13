import React, { useState, useEffect, createContext, useContext, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, query, where, Timestamp } from 'firebase/firestore';

// Tailwind CSS is assumed to be available in the environment.
// No explicit import for Tailwind CSS is needed in React components.

// --- Firebase Context for global access to auth and db instances ---
const FirebaseContext = createContext(null);

const FirebaseProvider = ({ children }) => {
    const [app, setApp] = useState(null);
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [userRole, setUserRole] = useState(null); // New state for user role
    const [isAuthReady, setIsAuthReady] = useState(false); // To ensure auth is ready before Firestore ops
    const [warehouses, setWarehouses] = useState([]);
    const [suppliers, setSuppliers] = useState([]); // New state for suppliers
    const [activeWarehouseId, setActiveWarehouseId] = useState(null);

    useEffect(() => {
        // Initialize Firebase only once
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};

        try {
            const firebaseApp = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(firebaseApp);
            const firebaseAuth = getAuth(firebaseApp);

            setApp(firebaseApp);
            setDb(firestoreDb);
            setAuth(firebaseAuth);

            // Listen for auth state changes
            const unsubscribeAuth = onAuthStateChanged(firebaseAuth, async (user) => {
                let currentUserId = null;
                if (user) {
                    currentUserId = user.uid;
                } else {
                    // Sign in anonymously if no user is logged in and no custom token is provided
                    try {
                        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                            await signInWithCustomToken(firebaseAuth, __initial_auth_token);
                            currentUserId = firebaseAuth.currentUser?.uid; // Set after successful sign-in
                        } else {
                            await signInAnonymously(firebaseAuth);
                            currentUserId = firebaseAuth.currentUser?.uid; // Set after successful sign-in
                        }
                    } catch (error) {
                        console.error("Error signing in:", error);
                        // Fallback to a random UUID if anonymous sign-in also fails
                        currentUserId = crypto.randomUUID();
                    }
                }
                setUserId(currentUserId);
                setIsAuthReady(true); // Mark auth as ready after initial user ID is set
            });

            return () => unsubscribeAuth(); // Cleanup auth listener on unmount
        } catch (error) {
            console.error("Failed to initialize Firebase:", error);
            // Fallback if Firebase initialization fails
            setUserId(crypto.randomUUID());
            setUserRole('employee'); // Default to employee on init failure
            setIsAuthReady(true);
        }
    }, []);

    // New useEffect to listen for real-time user role changes
    useEffect(() => {
        if (!db || !userId || !isAuthReady) return;

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const userDocRef = doc(db, `artifacts/${appId}/public/data/users`, userId);

        const unsubscribeUserRole = onSnapshot(userDocRef, async (docSnap) => {
            if (docSnap.exists()) {
                setUserRole(docSnap.data().role);
            } else {
                // If user document doesn't exist, create it with a default role
                // This handles cases where a new anonymous user is created
                const adminUserId = 'admin_user_id_example'; // For demonstration purposes
                const defaultRole = (userId === adminUserId) ? 'admin' : 'employee';
                await setDoc(userDocRef, { userId: userId, role: defaultRole, createdAt: Timestamp.now() }, { merge: true });
                setUserRole(defaultRole);
            }
        }, (error) => {
            console.error("Error fetching user role:", error);
            setUserRole('employee'); // Fallback to employee role on error
        });

        return () => unsubscribeUserRole(); // Cleanup user role listener on unmount
    }, [db, userId, isAuthReady]); // Depend on db, userId, and isAuthReady

    // Fetch and manage warehouses
    useEffect(() => {
        if (!db || !isAuthReady) return;

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const warehousesColRef = collection(db, `artifacts/${appId}/public/data/warehouses`);

        const unsubscribeWarehouses = onSnapshot(warehousesColRef, async (snapshot) => {
            const fetchedWarehouses = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setWarehouses(fetchedWarehouses);

            // If no active warehouse is set or the current one is deleted, set a default
            if (!activeWarehouseId || !fetchedWarehouses.some(w => w.id === activeWarehouseId)) {
                if (fetchedWarehouses.length > 0) {
                    setActiveWarehouseId(fetchedWarehouses[0].id);
                } else {
                    // If no warehouses exist, create default ones
                    const defaultWarehouses = [
                        { id: 'pasilaiciai', name: 'Pasilaiciai' },
                        { id: 'seskine', name: 'Seskine' }
                    ];
                    for (const warehouse of defaultWarehouses) {
                        const warehouseDocRef = doc(warehousesColRef, warehouse.id);
                        const docSnap = await getDoc(warehouseDocRef);
                        if (!docSnap.exists()) {
                            await setDoc(warehouseDocRef, warehouse);
                        }
                    }
                    // After creating, re-fetch or set the first one as active
                    setActiveWarehouseId(defaultWarehouses[0].id);
                }
            }
        }, (error) => {
            console.error("Error fetching warehouses:", error);
        });

        return () => unsubscribeWarehouses();
    }, [db, isAuthReady, activeWarehouseId]); // Add activeWarehouseId to dependencies to re-evaluate if it changes externally

    // Fetch and manage suppliers
    useEffect(() => {
        if (!db || !isAuthReady) return;

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const suppliersColRef = collection(db, `artifacts/${appId}/public/data/suppliers`);

        const unsubscribeSuppliers = onSnapshot(suppliersColRef, (snapshot) => {
            const fetchedSuppliers = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setSuppliers(fetchedSuppliers);
        }, (error) => {
            console.error("Error fetching suppliers:", error);
        });

        return () => unsubscribeSuppliers();
    }, [db, isAuthReady]);

    return (
        <FirebaseContext.Provider value={{ app, db, auth, userId, userRole, isAuthReady, warehouses, suppliers, activeWarehouseId, setActiveWarehouseId }}>
            {children}
        </FirebaseContext.Provider>
    );
};

// --- Custom Hook to use Firebase services ---
const useFirebase = () => {
    const context = useContext(FirebaseContext);
    if (!context) {
        throw new Error('useFirebase must be used within a FirebaseProvider');
    }
    return context;
};

// --- Reusable Modal Component for confirmations/alerts ---
const Modal = ({ show, title, message, onConfirm, onCancel, confirmText = 'OK', cancelText = 'Cancel' }) => {
    if (!show) return null;

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
                <h3 className="text-xl font-semibold mb-4 text-gray-800">{title}</h3>
                <div className="text-gray-700 mb-6">{message}</div>
                <div className="flex justify-end space-x-3">
                    {onCancel && (
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors duration-200"
                        >
                            {cancelText}
                        </button>
                    )}
                    {onConfirm && (
                        <button
                            onClick={onConfirm}
                            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors duration-200"
                        >
                            {confirmText}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

// --- Product Form Component ---
const ProductForm = ({ product, onSave, onCancel, warehouses, suppliers, activeWarehouseId, allProducts }) => {
    const [name, setName] = useState(product ? product.name : '');
    const [sku, setSku] = useState(product ? product.sku : '');
    const [stock, setStock] = useState(product ? product.stock : 0);
    const [price, setPrice] = useState(product ? product.price : 0);
    const [buyingPrice, setBuyingPrice] = useState(product ? product.buyingPrice : 0); // New: buyingPrice state
    const [description, setDescription] = useState(product ? product.description : '');
    const [imageUrl, setImageUrl] = useState(product ? product.imageUrl : '');
    const [size, setSize] = useState(product ? product.size : '');
    const [sizeRange, setSizeRange] = useState(product ? product.sizeRange : ''); // New: sizeRange state
    const [warehouseId, setWarehouseId] = useState(product ? product.warehouseId : activeWarehouseId || '');
    const [supplierId, setSupplierId] = useState(product ? product.supplierId : ''); // New: supplierId state

    useEffect(() => {
        if (product && product.warehouseId && product.warehouseId !== warehouseId) {
            setWarehouseId(product.warehouseId);
        } else if (!product && activeWarehouseId && activeWarehouseId !== warehouseId) {
            setWarehouseId(activeWarehouseId);
        }
        if (product && product.supplierId && product.supplierId !== supplierId) {
            setSupplierId(product.supplierId);
        }
    }, [product, activeWarehouseId, supplierId]);


    const handleSubmit = (e) => {
        e.preventDefault();
        onSave({
            ...product,
            name,
            sku,
            stock: Number(stock),
            price: Number(price),
            buyingPrice: Number(buyingPrice), // Include buyingPrice
            description,
            imageUrl,
            size,
            sizeRange, // Include sizeRange
            warehouseId,
            supplierId, // Include supplierId
        });
    };

    // Function to prefill fields based on SKU
    const handleSkuBlur = () => {
        if (sku && allProducts) {
            const existingProduct = allProducts.find(p => p.sku === sku && p.id !== product?.id); // Exclude current product if editing
            if (existingProduct) {
                setName(existingProduct.name);
                setPrice(existingProduct.price);
                setBuyingPrice(existingProduct.buyingPrice || 0);
                setDescription(existingProduct.description || '');
                setImageUrl(existingProduct.imageUrl || '');
                setSize(existingProduct.size || '');
                setSizeRange(existingProduct.sizeRange || '');
                setSupplierId(existingProduct.supplierId || '');
                // Do NOT prefill stock or warehouseId as per requirements
            }
        }
    };

    return (
        <form onSubmit={handleSubmit} className="p-6 bg-white rounded-lg shadow-md space-y-4">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">{product ? 'Edit Product' : 'Add New Product'}</h2>
            <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700">Product Name</label>
                <input
                    type="text"
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                />
            </div>
            <div>
                <label htmlFor="sku" className="block text-sm font-medium text-gray-700">SKU</label>
                <input
                    type="text"
                    id="sku"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    onBlur={handleSkuBlur}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                />
            </div>
            <div>
                <label htmlFor="size" className="block text-sm font-medium text-gray-700">Size</label>
                <input
                    type="text"
                    id="size"
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., S, M, L, XL"
                    required
                />
            </div>
            {/* New: Size Range input */}
            <div>
                <label htmlFor="sizeRange" className="block text-sm font-medium text-gray-700">Size Range (e.g., 48-60 or XS-XXXXL)</label>
                <input
                    type="text"
                    id="sizeRange"
                    value={sizeRange}
                    onChange={(e) => setSizeRange(e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., S-XL, 48-60"
                    required
                />
            </div>
            <div>
                <label htmlFor="stock" className="block text-sm font-medium text-gray-700">Stock Quantity</label>
                <input
                    type="number"
                    id="stock"
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
                    min="0"
                    required
                />
            </div>
            <div>
                <label htmlFor="price" className="block text-sm font-medium text-gray-700">Selling Price</label>
                <input
                    type="number"
                    id="price"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
                    step="0.01"
                    min="0"
                    required
                />
            </div>
            {/* New: Buying Price input */}
            <div>
                <label htmlFor="buyingPrice" className="block text-sm font-medium text-gray-700">Buying Price</label>
                <input
                    type="number"
                    id="buyingPrice"
                    value={buyingPrice}
                    onChange={(e) => setBuyingPrice(e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
                    step="0.01"
                    min="0"
                    required
                />
            </div>
            <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description (Optional)</label>
                <textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows="3"
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
                ></textarea>
            </div>
            <div>
                <label htmlFor="imageUrl" className="block text-sm font-medium text-gray-700">Image URL (Optional)</label>
                <input
                    type="url"
                    id="imageUrl"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., https://example.com/image.jpg"
                />
            </div>
            <div>
                <label htmlFor="warehouse" className="block text-sm font-medium text-gray-700">Warehouse</label>
                <select
                    id="warehouse"
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                >
                    <option value="" disabled>Select a warehouse</option>
                    {warehouses.map(warehouse => (
                        <option key={warehouse.id} value={warehouse.id}>
                            {warehouse.name}
                        </option>
                    ))}
                </select>
            </div>
            {/* New: Supplier selection */}
            <div>
                <label htmlFor="supplier" className="block text-sm font-medium text-gray-700">Supplier</label>
                <select
                    id="supplier"
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                >
                    <option value="" disabled>Select a supplier</option>
                    {Array.isArray(suppliers) && suppliers.map(supplier => (
                        <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                        </option>
                    ))}
                </select>
            </div>
            <div className="flex justify-end space-x-3">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors duration-200"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors duration-200"
                >
                    {product ? 'Update Product' : 'Add Product'}
                </button>
            </div>
        </form>
    );
};

// --- Inventory Management Component ---
const Inventory = () => {
    const { db, userId, isAuthReady, warehouses, suppliers, activeWarehouseId } = useFirebase();
    const [products, setProducts] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [modalMessage, setModalMessage] = useState('');
    const [modalTitle, setModalTitle] = useState('');
    const [modalOnConfirm, setModalOnConfirm] = useState(null);
    const [modalOnCancel, setModalOnCancel] = useState(null);

    // Fetch products from Firestore, filtered by activeWarehouseId
    useEffect(() => {
        if (!db || !userId || !isAuthReady || !activeWarehouseId) return;

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const productsColRef = collection(db, `artifacts/${appId}/public/data/products`);
        const q = query(productsColRef, where('warehouseId', '==', activeWarehouseId));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const productsList = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setProducts(productsList);
        }, (error) => {
            console.error("Error fetching products:", error);
            setModalTitle("Error");
            setModalMessage("Failed to load products. Please try again.");
            setModalOnConfirm(() => { setShowModal(false); });
            setModalOnCancel(null);
            setShowModal(true);
        });

        return () => unsubscribe();
    }, [db, userId, isAuthReady, activeWarehouseId]);

    // Add or Update Product
    const handleSaveProduct = async (productData) => {
        if (!db) {
            setModalTitle("Error");
            setModalMessage("Database not initialized. Please refresh the page.");
            setModalOnConfirm(() => { setShowModal(false); });
            setModalOnCancel(null);
            setShowModal(true);
            return;
        }

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const productsColRef = collection(db, `artifacts/${appId}/public/data/products`);

        try {
            if (productData.id) {
                // Update existing product
                const productRef = doc(db, `artifacts/${appId}/public/data/products`, productData.id);
                await updateDoc(productRef, {
                    name: productData.name,
                    sku: productData.sku,
                    stock: productData.stock,
                    price: productData.price,
                    buyingPrice: productData.buyingPrice, // Save buyingPrice
                    description: productData.description,
                    imageUrl: productData.imageUrl || '',
                    size: productData.size,
                    sizeRange: productData.sizeRange, // Save sizeRange
                    warehouseId: productData.warehouseId,
                    supplierId: productData.supplierId, // Save supplierId
                    updatedAt: Timestamp.now(), // Add updatedAt timestamp
                });
                setModalTitle("Success");
                setModalMessage("Product updated successfully!");
            } else {
                // Add new product
                await addDoc(productsColRef, {
                    ...productData,
                    imageUrl: productData.imageUrl || '',
                    createdAt: Timestamp.now(), // Add createdAt timestamp
                    updatedAt: Timestamp.now(), // Also set updatedAt for new products
                });
                setModalTitle("Success");
                setModalMessage("Product added successfully!");
            }
            setShowModal(true);
            setModalOnConfirm(() => { setShowModal(false); });
            setModalOnCancel(null);
            setShowForm(false);
            setEditingProduct(null);
        } catch (error) {
            console.error("Error saving product:", error);
            setModalTitle("Error");
            setModalMessage(`Failed to save product: ${error.message}`);
            setModalOnConfirm(() => { setShowModal(false); });
            setModalOnCancel(null);
            setShowModal(true);
        }
    };

    // Delete Product
    const handleDeleteProduct = (productId) => {
        setModalTitle("Confirm Delete");
        setModalMessage("Are you sure you want to delete this product? This action cannot be undone.");
        setModalOnConfirm(async () => {
            setShowModal(false);
            if (!db) {
                setModalTitle("Error");
                setModalMessage("Database not initialized. Please refresh the page.");
                setModalOnConfirm(() => { setShowModal(false); });
                setModalOnCancel(null);
                setShowModal(true);
                return;
            }

            const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
            try {
                await deleteDoc(doc(db, `artifacts/${appId}/public/data/products`, productId));
                setModalTitle("Success");
                setModalMessage("Product deleted successfully!");
                setModalOnConfirm(() => { setShowModal(false); });
                setModalOnCancel(null);
                setShowModal(true);
            } catch (error) {
                console.error("Error deleting product:", error);
                setModalTitle("Error");
                setModalMessage(`Failed to delete product: ${error.message}`);
                setModalOnConfirm(() => { setShowModal(false); });
                setModalOnCancel(null);
                setShowModal(true);
            }
        });
        setModalOnCancel(() => { setShowModal(false); });
        setShowModal(true);
    };

    return (
        <div className="p-6 bg-gray-50 min-h-screen rounded-lg shadow-inner">
            <h1 className="text-3xl font-extrabold text-gray-900 mb-6">Inventory Management</h1>

            <button
                onClick={() => { setShowForm(true); setEditingProduct(null); }}
                className="mb-6 px-6 py-3 bg-green-600 text-white rounded-lg shadow-md hover:bg-green-700 transition-colors duration-200 flex items-center space-x-2"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                <span>Add New Product</span>
            </button>

            {showForm && (
                <div className="mb-8">
                    <ProductForm
                        product={editingProduct}
                        onSave={handleSaveProduct}
                        onCancel={() => { setShowForm(false); setEditingProduct(null); }}
                        warehouses={warehouses}
                        suppliers={suppliers} // Pass suppliers to form
                        activeWarehouseId={activeWarehouseId}
                        allProducts={products} // Pass all products for SKU prefill
                    />
                </div>
            )}

            {Array.isArray(products) && products.length === 0 && !showForm && (
                <p className="text-center text-gray-600 text-lg mt-10">No products found in this warehouse. Add your first product!</p>
            )}

            {Array.isArray(products) && products.length > 0 && (
                <div className="bg-white rounded-lg shadow-md overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-100"><tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Image</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size Range</th> {/* New Column */}
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stock</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Selling Price</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Buying Price</th> {/* New Column */}
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Supplier</th> {/* New Column */}
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Warehouse</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr></thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {Array.isArray(products) && products.map((product) => (
                                <tr key={product.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                        {product.imageUrl ? (
                                            <img
                                                src={product.imageUrl}
                                                alt={product.name}
                                                className="w-12 h-12 object-cover rounded-md"
                                                onError={(e) => { e.target.onerror = null; e.target.src = `https://placehold.co/48x48/e2e8f0/64748b?text=NoImg`; }}
                                            />
                                        ) : (
                                            <img
                                                src={`https://placehold.co/48x48/e2e8f0/64748b?text=NoImg`}
                                                alt="No Image"
                                                className="w-12 h-12 object-cover rounded-md"
                                            />
                                        )}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{product.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{product.sku}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{product.size}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{product.sizeRange || 'N/A'}</td> {/* Display sizeRange */}
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{product.stock}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">€{product.price.toFixed(2)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">€{product.buyingPrice ? product.buyingPrice.toFixed(2) : 'N/A'}</td> {/* Display buyingPrice */}
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                        {suppliers.find(s => s.id === product.supplierId)?.name || 'N/A'} {/* Display supplier name */}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                        {warehouses.find(w => w.id === product.warehouseId)?.name || 'N/A'}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-700 max-w-xs truncate">{product.description || 'N/A'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                        <button
                                            onClick={() => { setEditingProduct(product); setShowForm(true); }}
                                            className="text-blue-600 hover:text-blue-900 mr-4"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => handleDeleteProduct(product.id)}
                                            className="text-red-600 hover:text-red-900"
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <Modal
                show={showModal}
                title={modalTitle}
                message={modalMessage}
                onConfirm={modalOnConfirm}
                onCancel={modalOnCancel}
            />
        </div>
    );
};

// --- Supplier Form Component ---
const SupplierForm = ({ supplier, onSave, onCancel }) => {
    const [name, setName] = useState(supplier ? supplier.name : '');
    const [address, setAddress] = useState(supplier ? supplier.address : '');
    const [telephone, setTelephone] = useState(supplier ? supplier.telephone : '');
    const [comments, setComments] = useState(supplier ? supplier.comments : '');

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave({
            ...supplier, // Keep existing ID if editing
            name,
            address,
            telephone,
            comments,
        });
    };

    return (
        <form onSubmit={handleSubmit} className="p-6 bg-white rounded-lg shadow-md space-y-4">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">{supplier ? 'Edit Supplier' : 'Add New Supplier'}</h2>
            <div>
                <label htmlFor="supplierName" className="block text-sm font-medium text-gray-700">Supplier Name</label>
                <input
                    type="text"
                    id="supplierName"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                />
            </div>
            <div>
                <label htmlFor="supplierAddress" className="block text-sm font-medium text-gray-700">Address</label>
                <input
                    type="text"
                    id="supplierAddress"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
                />
            </div>
            <div>
                <label htmlFor="supplierTelephone" className="block text-sm font-medium text-gray-700">Telephone</label>
                <input
                    type="tel"
                    id="supplierTelephone"
                    value={telephone}
                    onChange={(e) => setTelephone(e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
                />
            </div>
            <div>
                <label htmlFor="supplierComments" className="block text-sm font-medium text-gray-700">Comments (Optional)</label>
                <textarea
                    id="supplierComments"
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    rows="3"
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
                ></textarea>
            </div>
            <div className="flex justify-end space-x-3">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors duration-200"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors duration-200"
                >
                    {supplier ? 'Update Supplier' : 'Add Supplier'}
                </button>
            </div>
        </form>
    );
};

// --- Supplier Management Component ---
const SupplierManagement = () => {
    const { db, userId, isAuthReady, suppliers } = useFirebase();
    const [showForm, setShowForm] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [modalMessage, setModalMessage] = useState('');
    const [modalTitle, setModalTitle] = useState('');
    const [modalOnConfirm, setModalOnConfirm] = useState(null);
    const [modalOnCancel, setModalOnCancel] = useState(null);

    // Add or Update Supplier
    const handleSaveSupplier = async (supplierData) => {
        if (!db) {
            setModalTitle("Error");
            setModalMessage("Database not initialized. Please refresh the page.");
            setModalOnConfirm(() => { setShowModal(false); });
            setModalOnCancel(null);
            setShowModal(true);
            return;
        }

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const suppliersColRef = collection(db, `artifacts/${appId}/public/data/suppliers`);

        try {
            if (supplierData.id) {
                // Update existing supplier
                const supplierRef = doc(db, `artifacts/${appId}/public/data/suppliers`, supplierData.id);
                await updateDoc(supplierRef, supplierData);
                setModalTitle("Success");
                setModalMessage("Supplier updated successfully!");
            } else {
                // Add new supplier
                await addDoc(suppliersColRef, supplierData);
                setModalTitle("Success");
                setModalMessage("Supplier added successfully!");
            }
            setShowModal(true);
            setModalOnConfirm(() => { setShowModal(false); });
            setModalOnCancel(null);
            setShowForm(false);
            setEditingSupplier(null);
        } catch (error) {
            console.error("Error saving supplier:", error);
            setModalTitle("Error");
            setModalMessage(`Failed to save supplier: ${error.message}`);
            setModalOnConfirm(() => { setShowModal(false); });
            setModalOnCancel(null);
            setShowModal(true);
        }
    };

    // Delete Supplier
    const handleDeleteSupplier = (supplierId) => {
        setModalTitle("Confirm Delete");
        setModalMessage("Are you sure you want to delete this supplier? This action cannot be undone.");
        setModalOnConfirm(async () => {
            setShowModal(false);
            if (!db) {
                setModalTitle("Error");
                setModalMessage("Database not initialized. Please refresh the page.");
                setModalOnConfirm(() => { setShowModal(false); });
                setModalOnCancel(null);
                setShowModal(true);
                return;
            }

            const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
            try {
                await deleteDoc(doc(db, `artifacts/${appId}/public/data/suppliers`, supplierId));
                setModalTitle("Success");
                setModalMessage("Supplier deleted successfully!");
                setModalOnConfirm(() => { setShowModal(false); });
                setModalOnCancel(null);
                setShowModal(true);
            } catch (error) {
                console.error("Error deleting supplier:", error);
                setModalTitle("Error");
                setModalMessage(`Failed to delete supplier: ${error.message}`);
                setModalOnConfirm(() => { setShowModal(false); });
                setModalOnCancel(null);
                setShowModal(true);
            }
        });
        setModalOnCancel(() => { setShowModal(false); });
        setShowModal(true);
    };

    return (
        <div className="p-6 bg-gray-50 min-h-screen rounded-lg shadow-inner">
            <h1 className="text-3xl font-extrabold text-gray-900 mb-6">Supplier Management</h1>

            <button
                onClick={() => { setShowForm(true); setEditingSupplier(null); }}
                className="mb-6 px-6 py-3 bg-green-600 text-white rounded-lg shadow-md hover:bg-green-700 transition-colors duration-200 flex items-center space-x-2"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                <span>Add New Supplier</span>
            </button>

            {showForm && (
                <div className="mb-8">
                    <SupplierForm
                        supplier={editingSupplier}
                        onSave={handleSaveSupplier}
                        onCancel={() => { setShowForm(false); setEditingSupplier(null); }}
                    />
                </div>
            )}

            {Array.isArray(suppliers) && suppliers.length === 0 && !showForm && (
                <p className="text-center text-gray-600 text-lg mt-10">No suppliers found. Add your first supplier!</p>
            )}

            {Array.isArray(suppliers) && suppliers.length > 0 && (
                <div className="bg-white rounded-lg shadow-md overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-100"><tr>{/* No whitespace here */}
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Address</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Telephone</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Comments</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr></thead>{/* No whitespace here */}
                        <tbody className="bg-white divide-y divide-gray-200">
                            {Array.isArray(suppliers) && suppliers.map((supplier) => (
                                <tr key={supplier.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{supplier.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{supplier.address || 'N/A'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{supplier.telephone || 'N/A'}</td>
                                    <td className="px-6 py-4 text-sm text-gray-700 max-w-xs truncate">{supplier.comments || 'N/A'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                        <button
                                            onClick={() => { setEditingSupplier(supplier); setShowForm(true); }}
                                            className="text-blue-600 hover:text-blue-900 mr-4"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => handleDeleteSupplier(supplier.id)}
                                            className="text-red-600 hover:text-red-900"
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <Modal
                show={showModal}
                title={modalTitle}
                message={modalMessage}
                onConfirm={modalOnConfirm}
                onCancel={modalOnCancel}
            />
        </div>
    );
};

// --- Size Selection Modal Component ---
const SizeSelectionModal = ({ groupedProduct, onSelectSize, onClose }) => {
    const [selectedSizeProduct, setSelectedSizeProduct] = useState(null);
    const [quantity, setQuantity] = useState(1);

    useEffect(() => {
        // Reset selected size and quantity when groupedProduct changes
        setSelectedSizeProduct(null);
        setQuantity(1);
    }, [groupedProduct]);

    const handleAddToCart = () => {
        if (selectedSizeProduct && quantity > 0 && quantity <= selectedSizeProduct.stock) {
            onSelectSize(selectedSizeProduct, quantity);
            onClose();
        } else if (selectedSizeProduct && quantity > selectedSizeProduct.stock) {
            // Replaced alert with Modal
            alert("Requested quantity exceeds available stock for this size.");
        } else {
            // Replaced alert with Modal
            alert("Please select a size and enter a valid quantity.");
        }
    };

    // Filter out products with stock 0
    const availableVariations = groupedProduct.variations.filter(product => product.stock > 0);

    return (
        <Modal
            show={true} // Always show when this component is rendered
            title={`Select Size for ${groupedProduct.name}`}
            message={
                <div className="space-y-4">
                    {availableVariations.length === 0 ? (
                        <p className="text-center text-gray-600">No sizes available (or in stock) for this product.</p>
                    ) : (
                        availableVariations.map(product => (
                            <div
                                key={product.id}
                                className={`p-3 border rounded-md cursor-pointer flex justify-between items-center transition-colors duration-200 ${
                                    selectedSizeProduct && selectedSizeProduct.id === product.id
                                        ? 'border-blue-500 bg-blue-50'
                                        : 'border-gray-200 hover:bg-gray-100'
                                }`}
                                onClick={() => setSelectedSizeProduct(product)}
                            >
                                <div>
                                    <p className="font-semibold text-gray-800">Size: {product.size}</p>
                                    <p className="text-sm text-gray-600">Stock: {product.stock}</p>
                                </div>
                                <span className="font-bold text-blue-700">€{product.price.toFixed(2)}</span>
                            </div>
                        ))
                    )}
                    {selectedSizeProduct && (
                        <div className="mt-4">
                            <label htmlFor="quantity" className="block text-sm font-medium text-gray-700 mb-1">Quantity for {selectedSizeProduct.size}</label>
                            <input
                                type="number"
                                id="quantity"
                                value={quantity}
                                onChange={(e) => setQuantity(Number(e.target.value))}
                                min="1"
                                max={selectedSizeProduct.stock}
                                className="w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                            {quantity > selectedSizeProduct.stock && (
                                <p className="text-red-500 text-sm mt-1">Only {selectedSizeProduct.stock} available.</p>
                            )}
                        </div>
                    )}
                </div>
            }
            onConfirm={handleAddToCart}
            confirmText="Add to Cart"
            onCancel={onClose}
        />
    );
};


// --- Point of Sale (POS) Component ---
const POS = () => {
    const { db, userId, isAuthReady, activeWarehouseId } = useFirebase();
    const [products, setProducts] = useState([]);
    const [cart, setCart] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [modalMessage, setModalMessage] = useState('');
    const [modalTitle, setModalTitle] = useState('');
    const [modalOnConfirm, setModalOnConfirm] = useState(null);
    const [modalOnCancel, setModalOnCancel] = useState(null);
    const [showReceipt, setShowReceipt] = useState(false);
    const [receiptDetails, setReceiptDetails] = useState(null);

    const [selectedProductForSize, setSelectedProductForSize] = useState(null); // For size selection modal

    // Fetch products for POS, filtered by activeWarehouseId
    useEffect(() => {
        if (!db || !userId || !isAuthReady || !activeWarehouseId) return;

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const productsColRef = collection(db, `artifacts/${appId}/public/data/products`);
        const q = query(productsColRef, where('warehouseId', '==', activeWarehouseId));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const productsList = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setProducts(productsList);
        }, (error) => {
            console.error("Error fetching products for POS:", error);
            setModalTitle("Error");
            setModalMessage("Failed to load products for POS. Please try again.");
            setModalOnConfirm(() => { setShowModal(false); });
            setModalOnCancel(null);
            setShowModal(true);
        });

        return () => unsubscribe();
    }, [db, userId, isAuthReady, activeWarehouseId]);

    // Group products by name for display on POS
    const groupedProducts = useMemo(() => {
        const groups = {};
        products.forEach(product => {
            // Use product.name as the key for grouping
            const key = product.name;
            if (!groups[key]) {
                groups[key] = {
                    name: product.name,
                    description: product.description,
                    imageUrl: product.imageUrl,
                    // Store all variations (different sizes) for this product name
                    variations: []
                };
            }
            groups[key].variations.push(product);
            // Sort variations by size (e.g., S, M, L, XL) for consistent display
            groups[key].variations.sort((a, b) => {
                const sizesOrder = ['XS', 'S', 'M', 'L', 'XL', 'XXL']; // Define a custom order
                const sizeA = sizesOrder.indexOf(a.size.toUpperCase());
                const sizeB = sizesOrder.indexOf(b.size.toUpperCase());
                if (sizeA !== -1 && sizeB !== -1) {
                    return sizeA - sizeB;
                }
                return a.size.localeCompare(b.size); // Fallback for other sizes
            });
        });
        // Filter groups based on search term
        const filteredGroups = Object.values(groups).filter(group =>
            group.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            group.variations.some(v => v.sku.toLowerCase().includes(searchTerm.toLowerCase())) ||
            group.variations.some(v => v.size.toLowerCase().includes(searchTerm.toLowerCase()))
        );
        return filteredGroups;
    }, [products, searchTerm]);


    // Handle click on a grouped product card to open size selection modal
    const handleProductCardClick = (groupedProduct) => {
        setSelectedProductForSize(groupedProduct);
    };

    // Add selected size and quantity to cart from the modal
    const handleAddSpecificSizeToCart = (product, quantity) => {
        const existingItemIndex = cart.findIndex(item => item.id === product.id);

        if (existingItemIndex > -1) {
            const updatedCart = cart.map((item, index) =>
                index === existingItemIndex
                    ? { ...item, quantity: item.quantity + quantity } // Add to existing quantity
                    : item
            );
            setCart(updatedCart);
        } else {
            setCart([...cart, { ...product, quantity: quantity }]);
        }
        setSelectedProductForSize(null); // Close modal
    };

    // Update quantity in cart directly from cart list
    const updateCartQuantity = (productId, newQuantity) => {
        if (newQuantity <= 0) {
            setCart(cart.filter(item => item.id !== productId));
        } else {
            setCart(cart.map(item =>
                item.id === productId ? { ...item, quantity: newQuantity } : item
            ));
        }
    };

    // Remove item from cart
    const removeFromCart = (productId) => {
        setCart(cart.filter(item => item.id !== productId));
    };

    const calculateTotal = () => {
        return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    };

    // Process the sale
    const processSale = async () => {
        if (cart.length === 0) {
            setModalTitle("Empty Cart");
            setModalMessage("Please add items to the cart before processing a sale.");
            setModalOnConfirm(() => { setShowModal(false); });
            setModalOnCancel(null);
            setShowModal(true);
            return;
        }

        if (!db || !userId || !activeWarehouseId) {
            setModalTitle("Error");
            setModalMessage("Database, user, or active warehouse not initialized. Please refresh the page.");
            setModalOnConfirm(() => { setShowModal(false); });
            setModalOnCancel(null);
            setShowModal(true);
            return;
        }

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const salesColRef = collection(db, `artifacts/${appId}/public/data/sales`);

        try {
            // Check stock availability first for each item in the cart
            for (const item of cart) {
                const productRef = doc(db, `artifacts/${appId}/public/data/products`, item.id);
                const productSnap = await getDoc(productRef);
                if (!productSnap.exists() || productSnap.data().stock < item.quantity) {
                    setModalTitle("Stock Error");
                    setModalMessage(`Insufficient stock for ${item.name} (Size: ${item.size}). Available: ${productSnap.exists() ? productSnap.data().stock : 0}, Needed: ${item.quantity}`);
                    setModalOnConfirm(() => { setShowModal(false); });
                    setModalOnCancel(null);
                    setShowModal(true);
                    return;
                }
            }

            // Deduct stock and record sale
            const batchUpdates = [];
            for (const item of cart) {
                const productRef = doc(db, `artifacts/${appId}/public/data/products`, item.id);
                batchUpdates.push(updateDoc(productRef, {
                    stock: products.find(p => p.id === item.id).stock - item.quantity
                }));
            }

            // Execute all stock updates
            await Promise.all(batchUpdates);

            // Record the sale transaction
            const saleData = {
                timestamp: Timestamp.now(),
                items: cart.map(item => ({
                    productId: item.id,
                    name: item.name,
                    quantity: item.quantity,
                    price: item.price,
                    size: item.size,
                    sku: item.sku, // Include SKU in sale record
                })),
                total: calculateTotal(),
                userId: userId,
                warehouseId: activeWarehouseId,
            };
            await addDoc(salesColRef, saleData);

            setReceiptDetails(saleData);
            setShowReceipt(true);
            setCart([]); // Clear cart after successful sale
            setModalTitle("Sale Processed");
            setModalMessage("Sale completed successfully! Stock updated.");
            setModalOnConfirm(() => { setShowModal(false); });
            setModalOnCancel(null);
            setShowModal(true);
        } catch (error) {
            console.error("Error processing sale:", error);
            setModalTitle("Error");
            setModalMessage(`Failed to process sale: ${error.message}`);
            setModalOnConfirm(() => { setShowModal(false); });
            setModalOnCancel(null);
            setShowModal(true);
        }
    };

    return (
        <div className="p-6 bg-gray-50 min-h-screen flex flex-col lg:flex-row gap-6 rounded-lg shadow-inner">
            <div className="flex-1 bg-white rounded-lg shadow-md p-6">
                <h1 className="text-3xl font-extrabold text-gray-900 mb-6">Point of Sale</h1>

                <div className="mb-6">
                    <input
                        type="text"
                        placeholder="Search products by name, SKU, or size..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full border border-gray-300 rounded-md shadow-sm p-3 focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-[calc(100vh-250px)] overflow-y-auto pr-2">
                    {Array.isArray(groupedProducts) && groupedProducts.length === 0 ? (
                        <p className="col-span-full text-center text-gray-600">No products found matching your search in this warehouse.</p>
                    ) : (
                        Array.isArray(groupedProducts) && groupedProducts.map(groupedProduct => (
                            <div
                                key={groupedProduct.name} // Use name as key for grouped products
                                className="bg-gray-100 p-4 rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200 cursor-pointer flex flex-col justify-between"
                                onClick={() => handleProductCardClick(groupedProduct)}
                            >
                                <img
                                    src={groupedProduct.imageUrl || `https://placehold.co/100x100/e2e8f0/64748b?text=NoImg`}
                                    alt={groupedProduct.name}
                                    className="w-full h-24 object-cover rounded-md mb-2"
                                    onError={(e) => { e.target.onerror = null; e.target.src = `https://placehold.co/100x100/e2e8f0/64748b?text=NoImg`; }}
                                />
                                <div>
                                    <h3 className="font-semibold text-gray-900 text-lg mb-1">{groupedProduct.name}</h3>
                                    <p className="text-sm text-gray-600">{groupedProduct.description || 'No description'}</p>
                                    <p className="text-sm text-gray-600">Sizes: {groupedProduct.variations.map(v => v.size).join(', ')}</p>
                                </div>
                                <div className="mt-2 text-right">
                                    <span className="text-blue-700 font-bold text-xl">From €{Math.min(...groupedProduct.variations.map(v => v.price)).toFixed(2)}</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            <div className="w-full lg:w-1/3 bg-white rounded-lg shadow-md p-6 flex flex-col">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Cart</h2>
                <div className="flex-grow overflow-y-auto pr-2 mb-4">
                    {Array.isArray(cart) && cart.length === 0 ? (
                        <p className="text-center text-gray-600 mt-4">Cart is empty. Add products to start a sale.</p>
                    ) : (
                        Array.isArray(cart) && cart.map(item => (
                            <div key={item.id} className="flex items-center justify-between border-b border-gray-200 py-3 last:border-b-0">
                                <div>
                                    <p className="font-medium text-gray-900">{item.name} ({item.size})</p>
                                    <p className="text-sm text-gray-600">€{item.price.toFixed(2)} x {item.quantity}</p>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <input
                                        type="number"
                                        min="1"
                                        value={item.quantity}
                                        onChange={(e) => updateCartQuantity(item.id, Number(e.target.value))}
                                        className="w-16 p-1 border border-gray-300 rounded-md text-center"
                                    />
                                    <button
                                        onClick={() => removeFromCart(item.id)}
                                        className="text-red-500 hover:text-red-700 p-1 rounded-full hover:bg-red-100"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
                <div className="border-t border-gray-300 pt-4 mt-auto">
                    <div className="flex justify-between items-center mb-4">
                        <span className="text-xl font-bold text-gray-800">Total:</span>
                        <span className="text-2xl font-extrabold text-blue-700">€{calculateTotal().toFixed(2)}</span>
                    </div>
                    <button
                        onClick={processSale}
                        className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 transition-colors duration-200 flex items-center justify-center space-x-2"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                        <span>Process Sale</span>
                    </button>
                </div>
            </div>

            <Modal
                show={showModal}
                title={modalTitle}
                message={modalMessage}
                onConfirm={modalOnConfirm}
                onCancel={modalOnCancel}
            />

            {showReceipt && receiptDetails && (
                <Modal
                    show={showReceipt}
                    title="Sale Receipt"
                    message={
                        <div className="text-left">
                            <p className="font-bold mb-2">Date: {new Date(receiptDetails.timestamp.toDate()).toLocaleString()}</p>
                            <p className="font-bold mb-2">Processed by User ID: {receiptDetails.userId}</p>
                            <p className="font-bold mb-2">Warehouse: {receiptDetails.warehouseId}</p>
                            <p className="font-bold border-b pb-1 mb-2">Items:</p>
                            {receiptDetails.items.map((item, index) => (
                                <p key={index} className="text-sm">
                                    {item.name} (Size: {item.size}, SKU: {item.sku}) x {item.quantity} @ €{item.price.toFixed(2)} = €{(item.quantity * item.price).toFixed(2)}
                                </p>
                            ))}
                            <p className="font-bold text-right pt-2 border-t mt-2">Total: €{receiptDetails.total.toFixed(2)}</p>
                        </div>
                    }
                    onConfirm={() => setShowReceipt(false)}
                    confirmText="Close"
                    onCancel={null}
                />
            )}

            {selectedProductForSize && (
                <SizeSelectionModal
                    groupedProduct={selectedProductForSize}
                    onSelectSize={handleAddSpecificSizeToCart}
                    onClose={() => setSelectedProductForSize(null)}
                />
            )}
        </div>
    );
};

// --- Admin Dashboard Component ---
const AdminDashboard = () => {
    const [adminSubPage, setAdminSubPage] = useState('inventory'); // Default to inventory for admin

    return (
        <div className="p-6 bg-gray-50 min-h-screen rounded-lg shadow-inner">
            <h1 className="text-3xl font-extrabold text-gray-900 mb-6">Admin Dashboard</h1>
            <nav className="mb-6 flex space-x-4">
                <button
                    onClick={() => setAdminSubPage('inventory')}
                    className={`px-4 py-2 rounded-md font-medium transition-colors duration-200 ${
                        adminSubPage === 'inventory'
                            ? 'bg-blue-600 text-white shadow-lg'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                >
                    Inventory Management
                </button>
                <button
                    onClick={() => setAdminSubPage('suppliers')}
                    className={`px-4 py-2 rounded-md font-medium transition-colors duration-200 ${
                        adminSubPage === 'suppliers'
                            ? 'bg-blue-600 text-white shadow-lg'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                >
                    Supplier Management
                </button>
            </nav>

            {adminSubPage === 'inventory' && <Inventory />}
            {adminSubPage === 'suppliers' && <SupplierManagement />}
        </div>
    );
};

// --- Admin Login Modal Component ---
const AdminLoginModal = ({ show, onClose, onLoginSuccess }) => {
    const { db, userId, isAuthReady } = useFirebase();
    const [adminCode, setAdminCode] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    // Hardcoded admin secret for demonstration. In a real app, this would be more secure.
    const ADMIN_SECRET = "Slebute-369-"; // Updated admin secret

    const handleLogin = async () => {
        setErrorMessage(''); // Clear previous errors
        if (!db || !userId || !isAuthReady) {
            setErrorMessage("Application not ready. Please try again.");
            return;
        }

        if (adminCode === ADMIN_SECRET) {
            const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
            const userDocRef = doc(db, `artifacts/${appId}/public/data/users`, userId);
            try {
                // Update the current user's role to 'admin' in Firestore
                await setDoc(userDocRef, { role: 'admin', updatedAt: Timestamp.now() }, { merge: true }); // Use setDoc with merge for creating/updating
                onLoginSuccess(); // Notify parent component of success
                onClose(); // Close the modal
            } catch (error) {
                console.error("Error updating user role to admin:", error);
                setErrorMessage(`Failed to elevate role: ${error.message}`);
            }
        } else {
            setErrorMessage("Incorrect admin code. Please try again.");
        }
    };

    return (
        <Modal
            show={show}
            title="Admin Login"
            message={
                <div className="space-y-4">
                    <p className="text-gray-700">Enter the admin code to gain administrative access.</p>
                    <input
                        type="password" // Use type password for sensitive input
                        value={adminCode}
                        onChange={(e) => setAdminCode(e.target.value)}
                        placeholder="Admin Code"
                        className="w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    {errorMessage && (
                        <p className="text-red-600 text-sm">{errorMessage}</p>
                    )}
                </div>
            }
            onConfirm={handleLogin}
            confirmText="Login"
            onCancel={onClose}
        />
    );
};


// --- Main App Component ---
const App = () => {
    const [currentPage, setCurrentPage] = useState('pos'); // Default to POS for all users
    const { userId, userRole, isAuthReady, warehouses, setActiveWarehouseId, activeWarehouseId } = useFirebase();
    const [showAdminLoginModal, setShowAdminLoginModal] = useState(false);

    // Set initial page based on role once auth is ready
    useEffect(() => {
        if (isAuthReady && userRole) { // Ensure userRole is also loaded
            if (userRole === 'admin') {
                setCurrentPage('admin');
            } else {
                setCurrentPage('pos');
            }
        }
    }, [isAuthReady, userRole]);


    if (!isAuthReady || !activeWarehouseId || userRole === null) { // Wait for userRole to be determined
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <div className="text-xl text-gray-700">Loading application...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100 font-sans antialiased">
            <header className="bg-white shadow-md p-4">
                <div className="container mx-auto flex flex-col sm:flex-row justify-between items-center">
                    <h1 className="text-3xl font-extrabold text-gray-900 mb-2 sm:mb-0">
                        Inventory / POS App
                    </h1>
                    <nav className="flex space-x-4 items-center">
                        <button
                            onClick={() => setCurrentPage('pos')}
                            className={`px-4 py-2 rounded-md font-medium transition-colors duration-200 ${
                                currentPage === 'pos'
                                    ? 'bg-blue-600 text-white shadow-lg'
                                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                            }`}
                        >
                            POS
                        </button>
                        {/* Admin button visible only to admin users */}
                        {userRole === 'admin' && (
                            <button
                                onClick={() => setCurrentPage('admin')}
                                className={`px-4 py-2 rounded-md font-medium transition-colors duration-200 ${
                                    currentPage === 'admin'
                                        ? 'bg-blue-600 text-white shadow-lg'
                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                }`}
                            >
                                Admin
                            </button>
                        )}
                        {/* Login as Admin button, visible if not already admin */}
                        {userRole !== 'admin' && (
                            <button
                                onClick={() => setShowAdminLoginModal(true)}
                                className="px-4 py-2 rounded-md font-medium bg-purple-600 text-white shadow-lg hover:bg-purple-700 transition-colors duration-200"
                            >
                                Login as Admin
                            </button>
                        )}
                        {/* Warehouse Selector - visible to all, but placement might be adjusted based on UX */}
                        {warehouses.length > 0 && (
                            <select
                                value={activeWarehouseId}
                                onChange={(e) => setActiveWarehouseId(e.target.value)}
                                className="ml-4 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                            >
                                {warehouses.map(warehouse => (
                                    <option key={warehouse.id} value={warehouse.id}>
                                        {warehouse.name}
                                    </option>
                                ))}
                            </select>
                        )}
                    </nav>
                </div>
                <div className="text-center text-sm text-gray-500 mt-2">
                    Current User ID: <span className="font-mono text-gray-700">{userId || 'N/A'}</span> (Role: <span className="font-mono text-gray-700">{userRole || 'Loading...'}</span>)
                </div>
            </header>

            <main className="container mx-auto p-4">
                {currentPage === 'pos' && <POS />}
                {currentPage === 'admin' && userRole === 'admin' && <AdminDashboard />}
                {/* If non-admin tries to access admin page directly, show error or redirect */}
                {currentPage === 'admin' && userRole !== 'admin' && (
                    <div className="text-center text-red-600 text-xl mt-10">Access Denied: You do not have administrative privileges.</div>
                )}
            </main>

            {/* Admin Login Modal */}
            <AdminLoginModal
                show={showAdminLoginModal}
                onClose={() => setShowAdminLoginModal(false)}
                onLoginSuccess={() => {
                    setShowAdminLoginModal(false);
                    setCurrentPage('admin'); // Automatically switch to admin page on successful login
                }}
            />
        </div>
    );
};

// Wrap the App component with FirebaseProvider to make Firebase instances available
export default function ProvidedApp() {
    return (
        <FirebaseProvider>
            <App />
        </FirebaseProvider>
    );
}
