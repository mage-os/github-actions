/**
 * Every storefront selector the suite uses, in one place.
 *
 * All of these are Luma's. Keeping them here is what makes a Hyva variant of
 * this suite a copy of this file with a different map, rather than a rewrite
 * of the specs -- and it means a spec that creates a product in the admin and
 * one that buys a fixture product agree on what a product page looks like.
 */
export const luma = {
    navCategory: '.navigation li.level0 > a',
    // The category/search listing wrapper. Scoping to it matters: Luma's
    // sidebar blocks render product items too, so an unscoped product-item
    // count on a category page counts things that are not in the category.
    productList: '.products.wrapper',
    productItem: '.product-item-info',
    productItemLink: 'a.product-item-link',
    pageTitle: '.page-title',
    productPrice: '.product-info-main .price',
    // The sku Luma prints under the product's details. On a configurable this
    // starts as the parent sku and is rewritten by JS once an option is
    // chosen, so a spec asserts that it is there and not what it says.
    productSku: '.product.attribute.sku .value',

    // Quick search, as Luma renders it in the header. Typing into it fires no
    // XHR on a default store -- measured: only Magento_Search/js/form-mini.js
    // loads -- so a search spec has no suggest request to wait for.
    searchInput: '#search',
    // The results count, as the toolbar renders it ("1 Item", "Items 1-12 of
    // 41"). One toolbar renders on a single page of results and two when
    // there is a second page, so this is read through .first().
    searchResultsCount: '.toolbar-amount',
    // The empty-result message. On a no-results page .products.wrapper is not
    // rendered at all, which is why the result count is read through it:
    // unscoped, .product-item-info matches 2 elements for one result and 1
    // element for none.
    searchNoResults: '.message.notice',
    // Luma's availability block. `.available` is the in-stock variant -- the
    // out-of-stock one is `.unavailable` -- so the selector matching at all
    // is the assertion, and a product the price index has not reached renders
    // neither.
    productStock: '.stock.available',
    productQty: '#qty',
    addToCart: '#product-addtocart-button',
    swatchGroup: '.swatch-attribute',
    swatchOption: '.swatch-option:not(.disabled)',
    optionSelect: 'select.super-attribute-select',
    cartSuccess: '.message-success',
    minicartCounter: '.minicart-wrapper .counter-number',
    cartItemName: '.cart.item .product-item-name',
    cartItem: '.cart.item',
    cartItemQty: '.cart.item input.qty',
    cartItemPrice: '.cart.item .col.price .price',
    cartItemSubtotal: '.cart.item .col.subtotal .price',
    // The totals block, by row class rather than by position: a store with
    // tax or a discount renders extra rows between these three.
    cartSubtotal: '.cart-totals .totals.sub .price',
    cartShipping: '.cart-totals .totals.shipping .price',
    cartGrandTotal: '.cart-totals .grand .price',
    proceedToCheckout: 'button[data-role="proceed-to-checkout"]',
    checkoutEmail: '#customer-email',
    shippingForm: '#co-shipping-form',
    shippingMethod: 'input[value="flatrate_flatrate"]',
    nextButton: 'button[data-role="opc-continue"]',
    paymentSection: '#checkout-step-payment',
    placeOrder: '#checkout-payment-method-load button.action.checkout.primary',
    successPageTitle: '.page-title',
    successBlock: '.checkout-success',
    // The increment id on the success page, as a link. success.phtml wraps it
    // in a.order-number only when the viewer can open the order, so this
    // matches for a signed-in shopper and not for a guest -- which is why the
    // guest spec matches the digits in the block instead.
    successOrderNumber: '.checkout-success a.order-number',

    // Checkout with an address already on the account. Measured on this store
    // with one saved address: the address is preselected in
    // .shipping-address-item.selected-item, and #co-shipping-form is still in
    // the DOM but hidden -- it is the New Address popup's form. So a spec
    // asserts that form is not *visible*; neither its absence nor its
    // presence says anything.
    checkoutSelectedAddress: '.shipping-address-item.selected-item',
    // The Ship To / shipping-method recap the payment step renders, in that
    // order: two blocks with the same class.
    checkoutShipTo: '.opc-block-shipping-information .shipping-information-content',

    // Account registration. Luma's own form, so it belongs in Luma's map:
    // firstname and lastname come from a shared name fieldset template, which
    // is why their ids carry no prefix while the email field's does.
    registerForm: '#form-validate',
    registerFirstName: '#firstname',
    registerLastName: '#lastname',
    registerEmail: '#email_address',
    registerPassword: '#password',
    registerPasswordConfirm: '#password-confirmation',
    registerSubmit: '#form-validate button[type="submit"]',

    // The address book's own form, which is #form-validate too -- the same id
    // the registration form uses, on a different page. Named separately so a
    // spec reads as what it is doing rather than as which template Magento
    // happened to reuse.
    addressForm: '#form-validate',
    addressSubmit: '#form-validate button[type="submit"]',
    // The Default Billing Address box on the Address Book page. The first
    // address a customer saves becomes the default for both billing and
    // shipping, so this is where a just-saved first address shows up.
    defaultBillingAddress: '.box-address-billing .box-content',
    errorMessage: '.message-error',
    successMessage: '.message-success',

    // Sign-in. Every selector here is scoped to .login-container, and that is
    // not tidiness. Magento renders the authentication popup -- the one
    // checkout opens -- into every page, and it carries a second copy of this
    // form with the SAME ids. Measured on the login page of Mage-OS 4.0.0:
    //
    //   #pass           name=password          hidden   (the popup)
    //   #password       name=login[password]   visible  (the form)
    //   #customer-email name=username          hidden   (the popup)
    //   #email          name=login[username]   visible  (the form)
    //   #send2          .action-login.secondary hidden  (the popup)
    //   #send2          .login.primary         visible  (the form)
    //
    // So an unscoped #send2 or #pass resolves to a hidden element and the
    // spec times out waiting for it to become clickable -- which reads as a
    // broken page rather than as a selector that matched the wrong copy.
    // .login-container holds only the real form.
    loginContainer: '.login-container',
    loginEmail: '.login-container input[name="login[username]"]',
    loginPassword: '.login-container input[name="login[password]"]',
    loginSubmit: '.login-container button#send2',

    // The account dashboard's Contact Information box. Server rendered,
    // unlike the header greeting, which arrives with private content and is
    // therefore a worse thing to assert on.
    accountInformation: '.box-information .box-content',
    // Luma renders the sign-out link four times -- header panel, account
    // menu, and the two copies the authentication popup brings -- and hides
    // every one of them until the header's customer-welcome switch is
    // clicked.
    customerWelcomeToggle: '.panel.header .customer-welcome button.action.switch',
    signOut: 'a[href*="customer/account/logout"]',

    // My Orders, and the order page it links to. The grid and the order's own
    // items table are both #my-orders-table -- sales_order_history.phtml and
    // order_items.phtml give them the same id -- so the grid is addressed
    // through its cells and the order through .table-order-items.
    orderHistoryRow: '#my-orders-table tbody tr',
    orderHistoryId: 'td.col.id',
    orderHistoryStatus: 'td.col.status',
    orderHistoryView: 'a.action.view',
    orderStatus: '.order-status',
    orderItems: '.table-order-items',
    // td, not th: the items table repeats every column label in its header.
    orderItemSku: '.table-order-items td.col.sku',
    orderItemName: '.table-order-items .product-item-name',
};

/**
 * Magento appends catalog/seo/product_url_suffix to a product's url key. The
 * default is .html and this gate never changes it, so a spec that navigates
 * straight to a product it just created can build the path itself instead of
 * hunting for a link to it.
 */
export const productUrlSuffix = process.env.MAGENTO_PRODUCT_URL_SUFFIX ?? '.html';

/** The storefront path for a product url key, e.g. storefrontUrl('a-product'). */
export function productUrl(urlKey: string): string {
    return `/${urlKey}${productUrlSuffix}`;
}

export const categoryUrlSuffix = process.env.MAGENTO_CATEGORY_URL_SUFFIX ?? '.html';

/**
 * Separate from productUrl because Magento configures the two suffixes
 * separately -- catalog/seo/category_url_suffix and product_url_suffix -- and
 * a store that changed one and not the other is a perfectly ordinary store.
 */
export function categoryUrl(urlKey: string): string {
    return `/${urlKey}${categoryUrlSuffix}`;
}
