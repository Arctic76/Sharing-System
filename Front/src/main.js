import Vue from 'vue'
import VueRouter from 'vue-router'
import VueResource from 'vue-resource'
import Vuex from 'vuex'
import $ from 'jquery';
import 'bootstrap/dist/js/bootstrap';

Vue.use(VueRouter);
Vue.use(VueResource);
Vue.use(Vuex);

const router = new VueRouter({
	mode: 'history',
	routes: [
		{
			name: 'home',
			path: '/',
			component: require('./view/home.vue')
		},
		{
			name: 'info',
			path: '/info/:id',
			component: require('./view/info.vue')
		},
		{
			name:'addInfo',
			path: '/newinfo',
			component: require('./view/addInfo.vue')
		},
		{
			name: 'signIn',
			path: '/sign-in',
			component: require('./view/sign-in.vue')
		},
		{
			name: 'signUp',
			path: '/sign-up',
			component: require('./view/sign-up.vue')
		},
		{
			name: 'myProfile',
			path: '/profile',
			component: require('./view/profile.vue')
		},
		{
			name: 'userProfile',
			path: '/profile/:id',
			component: require('./view/userProfile.vue')
		},
		{
			name: 'about',
			path: '/about',
			component: require('./view/about.vue')
		},
		{
			name: 'contact',
			path: '/contact',
			component: require('./view/contact.vue')
		}
	]
})

new Vue({
  el: '#app',
  router: router,
  render: h => h(require('./App.vue'))
});