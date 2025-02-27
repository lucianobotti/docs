import React from "react";
import { Navbar } from "react-bootstrap";
import { SearchNavigationLinks } from ".";
import SearchBar from "./search/";
import { Link, Logo } from "./";

const LogoLink = () => (
  <Link to="https://www.enterprisedb.com/" title="EDB Home">
    <Logo width="120" height="50" className="me-1" />
  </Link>
);

const DocsLink = () => (
  <Link
    to="/"
    className="me-3 lead text-muted pt-2 header-docs-link"
    title="EDB Docs homepage"
  >
    /<span className="ps-1">docs</span>
  </Link>
);

const SearchNavigation = ({ children, searchProduct, logo = false }) => {
  return (
    <Navbar variant="light" className="flex-md-nowrap p-3 border-bottom">
      {logo ? (
        <>
          {/* Homepage */}
          <LogoLink />
          <DocsLink />
        </>
      ) : (
        <></>
      )}
      <SearchBar searchProduct={searchProduct} />
      <SearchNavigationLinks />
    </Navbar>
  );
};

export default SearchNavigation;
